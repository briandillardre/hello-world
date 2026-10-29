/**
 * Voice answers, asserted (run: node scripts/voice-answer-test.mjs).
 *
 * matchSpoken decides which bubble a kid's spoken answer rolls the ball to —
 * a wrong match scores a wrong answer on a question the kid got RIGHT out
 * loud, so ambiguity must return null, never a guess. Run after ANY change
 * to lib/game/voice-answer.ts.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const src = readFileSync(new URL('../lib/game/voice-answer.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
const { matchSpoken, voiceable, normalizeSpoken, spokenNumber } = await import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; return }
  fail++
  console.log('✗', name, extra)
}
const m = (t, choices) => matchSpoken(t, choices)

// numbers — digits, words, compounds, homophones said alone
ok('digit transcript', m('7', ['5', '7', '9']) === 1)
ok('number word', m('seven', ['5', '7', '9']) === 1)
ok('in a sentence', m('I think it is seven', ['5', '7', '9']) === 1)
ok('compound twenty one', m('twenty one', ['19', '21', '23']) === 1)
ok('tens alone', m('forty', ['40', '44', '14']) === 0)
ok('"to" alone reads as 2', m('to', ['2', '4', '6']) === 0)
ok('"to" mid-sentence does NOT read as 2', m('I want to say six', ['2', '6', '8']) === 1)

// letters — names and homophones; case ambiguity refuses
ok('letter by homophone (why → Y)', m('why', ['Y', 'K', 'M']) === 0)
ok('letter bee → b', m('bee', ['b', 'd', 'p']) === 0)
ok('B vs b is ambiguous out loud', m('bee', ['b', 'B', 'd']) === null)
ok('plain letter', m('t', ['T', 'F', 'L']) === 0)

// words — sight words, CVC, rhymes
ok('sight word', m('because', ['because', 'again', 'every']) === 0)
ok('cvc word', m('cat', ['cat', 'cot', 'cut']) === 0)
ok('emoji-word choice matches by word', m('dog', ['🐶 dog', '🐱 cat', '🐟 fish']) === 0)

// multi-word settings — content words beat stopword differences
ok('full phrase', m('at the beach', ['at the beach', 'in the woods', 'at school']) === 0)
ok('content words only ("the beach")', m('the beach', ['at the beach', 'in the woods', 'at school']) === 0)
ok('phrase in a sentence', m('it happens at school I think', ['at the beach', 'in the woods', 'at school']) === 2)
ok('morning vs midnight', m('in the morning', ['in the morning', 'at midnight', 'at dinner']) === 0)

// blends — said as a word or spelled
ok('blend by word', m('sc', ['sc', 'sk', 'st']) === 0)
ok('blend spelled out (ess see)', m('ess see', ['sc', 'sk', 'st']) === 0)
ok('blend spelled out (ess kay)', m('s kay', ['sc', 'sk', 'st']) === 1)

// refusals — never guess
ok('gibberish → null', m('banana sandwich', ['5', '7', '9']) === null)
ok('empty → null', m('', ['a', 'b']) === null)
ok('two choices said at once → null', m('cat and dog', ['🐶 dog', '🐱 cat', '🐟 fish']) === null)

// voiceable gate — pure-emoji boards hide the mic
ok('emoji-only choices are not voiceable', voiceable(['🟢', '🟦', '🔺']) === false)
ok('emoji+word choices are voiceable', voiceable(['🐶 dog', '🐱 cat']) === true)
ok('word choices are voiceable', voiceable(['at the beach', 'in the woods']) === true)

// unit guards
ok('normalize strips emoji + punctuation', normalizeSpoken('🐶  Dog!!') === 'dog')
ok('spokenNumber compound', spokenNumber(['twenty', 'three']) === 23)
ok('spokenNumber none', spokenNumber(['hello', 'there']) === null)

console.log(fail === 0 ? `voice-answer: ${pass} assertions pass` : `${fail} FAILURES (${pass} passed)`)
process.exit(fail === 0 ? 0 : 1)
