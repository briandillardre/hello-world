/**
 * Import a repo TypeScript module from a node harness, following its RELATIVE
 * imports (./x, ../y) by transpiling each file and inlining it as a data URL.
 * Type-only imports vanish in the transpile. No bundler, no build — the same
 * trick the single-file harnesses use, made recursive so a module can grow
 * dependencies (e.g. questions.ts → banks/*.ts) without breaking its tests.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const cache = new Map()

function resolveTs(fromDir, spec) {
  const base = resolve(fromDir, spec)
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, resolve(base, 'index.ts')]) {
    if (existsSync(cand) && cand.match(/\.tsx?$/)) return cand
  }
  throw new Error(`ts-import: cannot resolve ${spec} from ${fromDir}`)
}

function toUrl(file) {
  if (cache.has(file)) return cache.get(file)
  const src = readFileSync(file, 'utf8')
  let js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 } }).outputText
  js = js.replace(/(from\s+|import\s*\(\s*)(['"])(\.{1,2}\/[^'"]+)\2/g, (_m, pre, _q, spec) => `${pre}${JSON.stringify(toUrl(resolveTs(dirname(file), spec)))}`)
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  cache.set(file, url)
  return url
}

/** import a .ts file (path relative to the CALLER's import.meta.url) */
export async function importTs(rel, callerUrl) {
  return import(toUrl(resolve(dirname(new URL(callerUrl).pathname), rel)))
}
