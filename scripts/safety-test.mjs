/**
 * 🦺 Safety, asserted (run: node scripts/safety-test.mjs).
 * Guards the toolbox-talk library shape, the report rules (what pages the
 * company, what may be OSHA-recordable) and the signature sanitizer — a
 * signature is rendered back into pages, so only clean M/L paths survive.
 * Run after ANY change to lib/safety/talks.ts.
 */
import { importTs } from './lib/ts-import.mjs'

const S = await importTs('../lib/safety/talks.ts', import.meta.url)
let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => { if (cond) { pass++; return } fail++; console.log('✗', name, extra) }

// library
ok('20+ talks', S.TALK_TOPICS.length >= 20)
ok('unique keys', new Set(S.TALK_TOPICS.map((t) => t.key)).size === S.TALK_TOPICS.length)
ok('every talk has 3–5 short points', S.TALK_TOPICS.every((t) => t.points.length >= 3 && t.points.length <= 5 && t.points.every((p) => p.length <= 200)))
ok('titles fit the column', S.TALK_TOPICS.every((t) => t.title.length <= 160 && t.key.length <= 40))
ok('trench talk says 5 feet', S.topicByKey('trench').points[0].includes('5 feet'))
ok('unknown topic → null', S.topicByKey('nope') === null && S.topicByKey(null) === null)

// report rules
ok('injury incident pages', S.reportUrgency({ kind: 'incident', injury: true, treatment: 'none' }) === 'page')
ok('treated incident pages even unticked', S.reportUrgency({ kind: 'incident', injury: false, treatment: 'first_aid' }) === 'page')
ok('near miss does not page', S.reportUrgency({ kind: 'near_miss', injury: false, treatment: 'none' }) === 'normal')
ok('damage-only incident does not page', S.reportUrgency({ kind: 'incident', injury: false, treatment: 'none' }) === 'normal')
ok('recordable = medical or lost time', S.maybeRecordable('medical') && S.maybeRecordable('lost_time') && !S.maybeRecordable('first_aid') && !S.maybeRecordable('none'))
ok('kind + treatment guards', S.isReportKind('near_miss') && !S.isReportKind('fire') && S.isTreatment('first_aid') && !S.isTreatment('x'))

// signatures
ok('clean path survives', S.cleanSignature('M10 20L30 40L50 60L70 80') === 'M10 20L30 40L50 60L70 80')
ok('decimals round, box clamps', S.cleanSignature('M10.6 20.4L400 -5L50 60L70 80') === 'M11 20L300 0L50 60L70 80')
ok('script/markup is stripped to numbers only', (() => { const s = S.cleanSignature('M10 20"/><script>alert(1)</script>L30 40L50 60L70 80'); return s !== null && !/[<>"a-z]/.test(s.replace(/[ML]/g, '')) })())
ok('a dot is not a signature', S.cleanSignature('M10 10L11 11') === null)
ok('non-string / empty refused', S.cleanSignature(null) === null && S.cleanSignature('') === null && S.cleanSignature({}) === null)
ok('implicit polyline pairs become L', S.cleanSignature('M1 1 2 2 3 3 4 4') === 'M1 1L2 2L3 3L4 4')
ok('giant input capped', S.cleanSignature('M1 1' + ' L100 50 L200 90'.repeat(3000)) === null)

console.log(fail === 0 ? `safety: ${pass} assertions pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
