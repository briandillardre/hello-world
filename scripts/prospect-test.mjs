// Prospective Client rules (Sep 23 2026): defaults, the never/hidden sets, nav states, the ladder. Run after ANY change to the prospect rules in lib/permissions.ts.
import { createRequire } from 'node:module'
import fs from 'node:fs'
const require = createRequire(new URL('../package.json', import.meta.url))
const ts = require('typescript')
const src = fs.readFileSync(new URL('../lib/permissions.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
const m = { exports: {} }
new Function('module', 'exports', 'require', js)(m, m.exports, require)
const P = m.exports
let n = 0, bad = 0
const ok = (cond, msg) => { n++; if (!cond) { bad++; console.log('FAIL', msg) } }
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg}: got ${JSON.stringify(a)} want ${JSON.stringify(b)}`)

// defaults
const pros = P.resolvePermissions({ role: 'prospect' }, false, null)
eq(pros.features, ['map','command','alerts','aircraft','assets','zones','measurements','maintenance','reports'], 'prospect default features')
ok(!pros.canEdit && !pros.canViewCosts && !pros.canManageBilling && !pros.canManageTeam, 'prospect has no abilities')
// the table can never widen past the sandbox
const wide = { prospect: Object.fromEntries(P.FEATURE_KEYS.map((k) => [k, true])) }
const widened = P.resolvePermissions({ role: 'prospect', can_view_costs: true, can_manage_team: true }, false, wide)
eq(widened.features, pros.features, 'all-on policy + person switches change nothing for a prospect')
// the table CAN narrow
const narrow = P.resolvePermissions({ role: 'prospect' }, false, { prospect: { command: false, reports: false } })
eq(narrow.features, ['map','alerts','aircraft','assets','zones','measurements','maintenance'], 'policy narrows a prospect')
// sets
ok(P.PROSPECT_HIDDEN.every((k) => P.PROSPECT_NEVER.includes(k)), 'hidden ⊂ never')
ok(P.PROSPECT_NEVER.every((k) => !P.ROLE_FEATURE_DEFAULTS.prospect[k]), 'defaults never include a NEVER key')
ok(!P.PROSPECT_NEVER.includes('command'), 'command is grantable now')
// nav states for a prospect with command switched off
const f = narrow.features
eq(P.navStateFor('/map', f, 'prospect'), 'open', 'map open')
eq(P.navStateFor('/command', f, 'prospect'), 'locked', 'command locked when off')
eq(P.navStateFor('/command', pros.features, 'prospect'), 'open', 'command open by default')
eq(P.navStateFor('/clock', f, 'prospect'), 'locked', 'clock locked')
eq(P.navStateFor('/timecards', f, 'prospect'), 'locked', 'timecards locked (clock key)')
eq(P.navStateFor('/logs', f, 'prospect'), 'locked', 'logs locked')
eq(P.navStateFor('/settings', f, 'prospect'), 'locked', 'settings locked')
eq(P.navStateFor('/assets/onboard', f, 'prospect'), 'locked', 'hardware locked')
eq(P.navStateFor('/team', f, 'prospect'), 'hidden', 'team hidden')
eq(P.navStateFor('/finance', f, 'prospect'), 'hidden', 'finance hidden')
eq(P.navStateFor('/activity', f, 'prospect'), 'hidden', 'activity hidden')
eq(P.navStateFor('/locked', f, 'prospect'), 'open', '/locked ungated')
eq(P.navStateFor('/settings/phone', f, 'prospect'), 'open', 'my phone ungated')
eq(P.navStateFor('/help', f, 'prospect'), 'open', 'help ungated')
// everyone else keeps the Sep 11 rule: absent, not locked
const assoc = P.resolvePermissions({ role: 'associate' }, false, null)
eq(P.navStateFor('/reports', assoc.features, 'associate'), 'hidden', 'associate: reports hidden, never locked')
eq(P.navStateFor('/command', assoc.features, 'associate'), 'hidden', 'associate: command hidden')
eq(P.navStateFor('/map', null, 'associate'), 'open', 'null features = everything open (demo)')
const master = P.resolvePermissions(null, true, null)
eq(P.navStateFor('/team', master.features, master.role), 'open', 'master sees team')
// helpers
eq(P.lockedHref('/clock'), '/locked?f=clock', 'lockedHref')
eq(P.lockedHref('/assets/onboard'), '/locked?f=hardware', 'lockedHref hardware')
eq(P.lockedHref('/timecards'), '/locked?f=clock&p=%2Ftimecards', 'lockedHref carries the tapped page when its label differs')
eq(P.lockedHref('/photos'), '/locked?f=logs&p=%2Fphotos', 'lockedHref photos')
eq(P.firstOpenHref(pros.features), '/map', 'home is the map when open')
eq(P.firstOpenHref(P.resolvePermissions({ role: 'prospect' }, false, { prospect: { map: false } }).features), '/command', 'home is the next open page when the map is off')
eq(P.firstOpenHref([]), null, 'nothing open = no home')
eq(P.featureLabel('clock'), 'Time clock', 'featureLabel')
eq(P.featureLabel('nope'), null, 'featureLabel unknown')
ok(P.isProspect({ role: 'prospect', isMaster: false }), 'isProspect')
ok(!P.isProspect({ role: 'admin', isMaster: true }), 'master is not a prospect')
ok(!P.isProspect({ role: 'associate', isMaster: false }), 'associate is not a prospect')
// the ladder is untouched
ok(P.outranks(master, { role: 'prospect', isMaster: false }), 'master outranks prospect')
ok(!P.outranks(P.resolvePermissions({ role: 'admin' }, false, null), { role: 'prospect', isMaster: false }), 'admin does not outrank prospect')
ok(!P.canSeeMember({ role: 'admin', isMaster: false, id: 'a' }, { id: 'p', role: 'prospect' }), 'admin cannot see a prospect')
ok(!P.canSeeMember({ role: 'prospect', isMaster: false, id: 'p' }, { id: 'a', role: 'admin' }), 'prospect sees nobody')
ok(!P.canSeeAsset(pros, {}, 'personnel'), 'prospect never sees a person')
ok(P.canSeeAsset(pros, {}, 'vehicle'), 'prospect sees an everyone-visible truck')
console.log(`${n - bad}/${n} assertions passed`)
process.exit(bad ? 1 : 0)
