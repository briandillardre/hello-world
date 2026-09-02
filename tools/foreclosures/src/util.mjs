import fs from 'node:fs'
import path from 'node:path'
import { UA } from './config.mjs'

export const OUT = process.env.FORECLOSURES_OUT || path.resolve(process.cwd(), 'out')
export function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); return p }
export function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') }
export const money = (n) => n == null ? '' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const parseMoney = (s) => { const m = String(s || '').replace(/[,$\s]/g, '').match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null }
export function log(...a) { console.error(new Date().toISOString().slice(11, 19), ...a) }
export const sleep = (ms) => new Promise(r => setTimeout(r, ms))

/** Plain fetch with a browser UA. Works for the county sites that don't sit behind a bot wall. */
export async function get(url, opts = {}) {
  const r = await fetch(url, { redirect: 'follow', ...opts, headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml,application/pdf,*/*;q=0.8', ...(opts.headers || {}) } })
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`)
  return r
}
export async function getText(url, opts) { return (await get(url, opts)).text() }
export async function getBuffer(url, opts) { return Buffer.from(await (await get(url, opts)).arrayBuffer()) }

/** Strip tags → whitespace-normalised text. Good enough for the notice/roster pages we read. */
export function htmlToText(html) {
  return String(html)
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d|td|th)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;|&rsquo;|&lsquo;/g, "'").replace(/&quot;|&ldquo;|&rdquo;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, '\n').trim()
}

export function readJson(p, dflt = null) { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return dflt } }
export function writeJson(p, v) { ensureDir(path.dirname(p)); fs.writeFileSync(p, JSON.stringify(v, null, 2)) }
