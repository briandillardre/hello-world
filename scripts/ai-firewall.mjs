#!/usr/bin/env node
/**
 * AI firewall — a build-time check, not a prompt instruction.
 *
 * Brian, Sep 4 2026: "make sure the ai is firewalled from any hammertrack
 * specific info such as the to do list, growth plan, etc."
 *
 * The assistant, the MCP door, the memo, insights and the briefings must
 * never be able to reach the founder material: the board (lib/board.ts),
 * docs/, CLAUDE.md, marketing/, the foreclosure tool, the founder gate.
 * This script walks the AI surface's import graph (TRANSITIVELY — a clean
 * file that imports a dirty one is dirty) and fails the build on the first
 * reach, on any filesystem read, and on any non-literal dynamic import
 * inside the surface, which is how the check would otherwise be dodged.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'

// Roots: everything that talks to a model, plus the MCP door.
const ROOTS = [
  'lib/ai-tools.ts', 'lib/mcp-tools.ts', 'lib/assistant.ts', 'lib/memo.ts', 'lib/insights.ts', 'lib/briefing.ts',
  'app/api/assistant', 'app/api/mcp', 'app/api/memo', 'app/api/insights', 'app/api/cron/memo',
  'app/api/asset-advisor', 'app/api/cron/agenda', 'app/api/cron/digest', 'app/api/value-estimate',
  'lib/actions/finance.ts', 'lib/receipts',
]
// Anything that imports the Anthropic SDK is on the surface whether listed or not.
const SDK = /@anthropic-ai\/sdk/

const FENCED_SPECIFIER = [
  /(^|\/)board$/, /components\/board/, /platform-owner$/, /\bdocs\//, /CLAUDE\.md/, /marketing\//, /tools\/foreclosures/,
]
// Text rules: filesystem reads only. A doc NAME in a comment ("see
// docs/GROWTH-PLATFORM.md") is not a reach; an import of it is, and the
// specifier rule above catches that.
const FENCED_TEXT = [
  /readFileSync|readFile\(|fs\/promises|from ['"]fs['"]|from ['"]node:fs['"]|require\(['"]fs['"]\)/,
]

function walk(p) {
  try {
    const st = statSync(p)
    if (st.isFile()) return [p]
    return readdirSync(p).flatMap((f) => walk(join(p, f)))
  } catch { return [] }
}
const isSrc = (f) => /\.(ts|tsx|mjs|js)$/.test(f)

/** Resolve an import specifier to a repo file, or null for packages. */
function resolveSpec(fromFile, spec) {
  let base
  if (spec.startsWith('@/')) base = spec.slice(2)
  else if (spec.startsWith('.')) base = join(dirname(fromFile), spec)
  else return null
  for (const cand of [base, base + '.ts', base + '.tsx', base + '.mjs', base + '.js', join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand
  }
  return base // unresolved local path — still checked by name below
}

const surface = new Set()
for (const r of ROOTS) for (const f of walk(r)) if (isSrc(f)) surface.add(f)
for (const f of [...walk('lib'), ...walk('app')]) if (isSrc(f) && SDK.test(readFileSync(f, 'utf8'))) surface.add(f)

let bad = 0
const seen = new Set()
const queue = [...surface]
while (queue.length) {
  const f = queue.shift()
  if (seen.has(f) || !existsSync(f)) continue
  seen.add(f)
  const src = readFileSync(f, 'utf8')
  for (const re of FENCED_TEXT) if (re.test(src)) { console.error(`ai-firewall: ${f} contains fenced material or a filesystem read (${re})`); bad++ }
  // Static + dynamic imports with literal specifiers.
  const specs = [...src.matchAll(/(?:from\s*|import\s*\(\s*|require\s*\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])
  for (const spec of specs) {
    const target = resolveSpec(f, spec)
    if (!target) continue
    const norm = target.replace(/\.(ts|tsx|mjs|js)$/, '')
    if (FENCED_SPECIFIER.some((re) => re.test(norm) || re.test(spec))) { console.error(`ai-firewall: ${f} reaches fenced module '${spec}'`); bad++ }
    else if (existsSync(target) && statSync(target).isFile()) queue.push(target)
  }
  // A dynamic import with a non-literal argument is a hole, not a feature.
  if (/import\s*\(\s*[^'"\s)]/.test(src)) { console.error(`ai-firewall: ${f} has a non-literal dynamic import`); bad++ }
}
if (bad) { console.error(`ai-firewall: ${bad} violation(s) across ${seen.size} files. The assistant must not be able to read founder material.`); process.exit(1) }
console.log(`ai-firewall: clean (${seen.size} files walked)`)
