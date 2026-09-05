#!/usr/bin/env node
/**
 * AI firewall — a build-time check, not a prompt instruction.
 *
 * Brian, Sep 4 2026: "make sure the ai is firewalled from any hammertrack
 * specific info such as the to do list, growth plan, etc."
 *
 * The in-app assistant, the MCP door and the owner memo must never be able
 * to reach the founder material: the board (lib/board.ts), the docs/ tree,
 * CLAUDE.md, the marketing plans. Today none of them import it; this script
 * makes that a build failure instead of a convention. It scans the AI
 * surface for imports/reads of the fenced material and exits non-zero.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const AI_SURFACE = [
  'lib/ai-tools.ts', 'lib/mcp-tools.ts', 'lib/assistant.ts', 'lib/memo.ts', 'lib/insights.ts', 'lib/briefing.ts',
  'app/api/assistant', 'app/api/mcp', 'app/api/memo', 'app/api/insights', 'app/api/cron/memo',
]
const FENCED = [
  /lib\/board/, /components\/board/, /\bdocs\//, /CLAUDE\.md/, /marketing\//, /tools\/foreclosures/,
  /PATH-TO-1B/, /GROWTH-PLATFORM/, /BUSINESS-PLAN/, /FOUNDING-25/, /HARDWARE-PRICING/,
  /platform-owner/,               // the founder gate must not be a data source either
  /readFileSync|readFile\(|fs\/promises|from 'fs'|from "fs"|from 'node:fs'/, // no filesystem reads at all
]

function files(p) {
  try {
    const st = statSync(p)
    if (st.isFile()) return [p]
    return readdirSync(p).flatMap((f) => files(join(p, f)))
  } catch { return [] }
}

let bad = 0
for (const root of AI_SURFACE) {
  for (const f of files(root)) {
    if (!/\.(ts|tsx|mjs|js)$/.test(f)) continue
    const src = readFileSync(f, 'utf8')
    src.split('\n').forEach((line, i) => {
      if (!/import|require\(|readFile|fs\b/.test(line)) return
      for (const re of FENCED) {
        if (re.test(line)) { console.error(`ai-firewall: ${f}:${i + 1} reaches fenced material: ${line.trim()}`); bad++ }
      }
    })
  }
}
if (bad) { console.error(`ai-firewall: ${bad} violation(s). The assistant must not be able to read founder material.`); process.exit(1) }
console.log('ai-firewall: clean')
