#!/usr/bin/env node
/**
 * The App Store listing in fastlane `deliver`'s layout, generated from the
 * same source as Play (store-assets/listing.json + store-assets/ios-*):
 *   ios/App/fastlane/metadata/en-US/*.txt     name, subtitle, description, keywords, …
 *   ios/App/fastlane/screenshots/en-US/*.png  iPhone 6.9" + iPad 13" (deliver sorts by size)
 * Both are generated — never edited, never committed (.gitignore). On Apple
 * approval day: node scripts/store-meta.mjs && (cd ios/App && fastlane deliver)
 * — docs/APP-STORE-PLAYBOOK.md → Approval day.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const j = JSON.parse(readFileSync(path.join(ROOT, 'store-assets/listing.json'), 'utf8'))
const a = j.apple
// The App Store has its own words where iPhone differs (apple.description); else Play's.
const desc = a.description ?? j.play.fullDescription
const description = Array.isArray(desc) ? desc.join('\n') : desc
const fields = {
  name: [a.name, 30], subtitle: [a.subtitle, 30], description: [description, 4000], keywords: [a.keywords, 100],
  promotional_text: [a.promotionalText, 170],
  // A first version takes no "What's New" (deliver errors on it) — empty means none.
  ...(a.releaseNotes ? { release_notes: [a.releaseNotes, 4000] } : {}),
  support_url: [a.supportUrl, 255], marketing_url: [a.marketingUrl, 255], privacy_url: [a.privacyUrl, 255],
}
for (const [k, [v, max]] of Object.entries(fields)) {
  if (!v || v.length > max) { console.error(`✗ ${k} is ${v?.length ?? 0} characters — the App Store allows 1–${max}.`); process.exit(1) }
}
const meta = path.join(ROOT, 'ios/App/fastlane/metadata/en-US')
mkdirSync(meta, { recursive: true })
for (const [k, [v]] of Object.entries(fields)) writeFileSync(path.join(meta, `${k}.txt`), v + '\n')

const shots = path.join(ROOT, 'ios/App/fastlane/screenshots/en-US')
rmSync(shots, { recursive: true, force: true })
mkdirSync(shots, { recursive: true })
let n = 0
for (const [dir, tag] of [['ios-6.9', 'iphone69'], ['ios-ipad-13', 'ipad13']]) {
  j.shots.forEach((shot, i) => {
    const f = path.join(ROOT, 'store-assets', dir, `${shot.key}.png`)
    if (existsSync(f)) { copyFileSync(f, path.join(shots, `${tag}-${String(i + 1).padStart(2, '0')}-${shot.key}.png`)); n++ }
  })
}
console.log(`✓ fastlane metadata (${Object.keys(fields).length} fields) + ${n} screenshots`)
