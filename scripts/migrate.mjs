/**
 * Auto-migrator — runs at the end of every Vercel build (`npm run build`),
 * so pushing a new supabase/migrations/NNN_*.sql file to master IS the
 * migration. No more pasting SQL into the dashboard.
 *
 * Behavior:
 *  - No SUPABASE_DB_URL env var → prints a note and exits 0 (local/sandbox
 *    builds and previews without the var stay unaffected).
 *  - Tracks applied files in a `schema_migrations` table.
 *  - FIRST run against the existing production DB: migrations 001–020 were
 *    applied by hand before this runner existed, so anything ≤ the baseline
 *    number is recorded as applied WITHOUT executing. A fresh/empty database
 *    (no `companies` table) applies everything from 001 — new installs get
 *    a full schema from a bare `git push`.
 *  - Each file runs in its own transaction; the first failure rolls back,
 *    exits 1, and (on Vercel) fails the build so broken schema never ships
 *    with code that expects it.
 *
 * SUPABASE_DB_URL: Supabase Dashboard → Project Settings → Database →
 * Connection string → "Session pooler" URI (port 5432), password filled in.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'

// Files 001..BASELINE were applied manually before the runner existed.
const BASELINE_THROUGH = 20

const url = process.env.SUPABASE_DB_URL
if (!url) {
  console.log('[migrate] SUPABASE_DB_URL not set — skipping (add it in Vercel to enable auto-migrations)')
  process.exit(0)
}

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'supabase', 'migrations')
const files = readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort()
if (!files.length) {
  console.log('[migrate] no migration files found — nothing to do')
  process.exit(0)
}

const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } })

try {
  await client.connect()
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      baseline   BOOLEAN NOT NULL DEFAULT FALSE
    )`)

  const { rows } = await client.query('SELECT name FROM schema_migrations')
  const applied = new Set(rows.map((r) => r.name))

  // First run on an ALREADY-MIGRATED database: record the hand-applied era.
  if (applied.size === 0) {
    const { rows: reg } = await client.query("SELECT to_regclass('public.companies') AS t")
    const established = !!reg[0]?.t
    if (established) {
      for (const f of files) {
        const num = Number(f.slice(0, 3))
        if (num <= BASELINE_THROUGH) {
          await client.query('INSERT INTO schema_migrations (name, baseline) VALUES ($1, TRUE) ON CONFLICT DO NOTHING', [f])
          applied.add(f)
        }
      }
      console.log(`[migrate] baselined ${applied.size} hand-applied migrations (001–${String(BASELINE_THROUGH).padStart(3, '0')})`)
    }
  }

  const pending = files.filter((f) => !applied.has(f))
  if (!pending.length) {
    console.log(`[migrate] up to date — ${applied.size} applied, nothing pending`)
    process.exit(0)
  }

  for (const f of pending) {
    const sql = readFileSync(join(dir, f), 'utf8')
    console.log(`[migrate] applying ${f} …`)
    try {
      await client.query('BEGIN')
      await client.query(sql)
      await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f])
      await client.query('COMMIT')
      console.log(`[migrate] ✓ ${f}`)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      console.error(`[migrate] ✗ ${f} FAILED: ${err.message}`)
      console.error('[migrate] build aborted — schema unchanged for this file; fix the SQL and push again')
      process.exit(1)
    }
  }
  console.log(`[migrate] done — ${pending.length} applied`)
  process.exit(0)
} catch (err) {
  console.error(`[migrate] connection/setup failed: ${err.message}`)
  process.exit(1)
} finally {
  await client.end().catch(() => {})
}
