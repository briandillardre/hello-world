import Anthropic from '@anthropic-ai/sdk'

/**
 * Is the Claude API answering? (Brian, Nov 7: "lets fix the claude api
 * credits".)
 *
 * Board #154 sat open for six weeks because nothing in the app could say
 * whether the key worked: when the model fails, Ask AI falls back to its
 * built-in engine and only the person asking sees the grey line. By Nov 7
 * the answers on record showed the model had been answering since Sep 26,
 * yet the board still said "out of credits".
 *
 * So the health cron asks once an hour — a 1-token request, a fraction of a
 * cent a day — keeps the verdict in system_state (`ai.status`), and tells the
 * founder feed only when the verdict CHANGES.
 */

export type AiStatus = {
  ok: boolean
  /** A category a person can act on, never the provider's raw text. */
  why: string | null
  model: string
  at: string
}

export const AI_STATUS_KEY = 'ai.status'

/** The everyday model (Ask AI, digests, agenda, advisor, receipts). */
export function everydayModel(): string {
  return process.env.AI_MODEL || 'claude-sonnet-5'
}

/** The provider's failure, as one plain sentence fragment. */
export function aiErrorCategory(err: unknown): string {
  if (err instanceof Anthropic.APIConnectionError) return 'couldn’t reach the AI service'
  if (err instanceof Anthropic.APIError) {
    const msg = String(err.message || '').toLowerCase()
    if (msg.includes('credit balance')) return 'the AI account is out of credits'
    if (err.status === 401) return 'the AI key was refused'
    if (err.status === 403) return 'the AI key isn’t allowed to do this'
    if (err.status === 404 || msg.includes('model')) return 'the AI model name wasn’t recognized'
    if (err.status === 429) return 'the AI service is rate-limiting us'
    if (err.status === 529 || msg.includes('overloaded')) return 'the AI service is overloaded'
    if (typeof err.status === 'number' && err.status >= 500) return 'the AI service had an outage'
  }
  return 'the AI service returned an error'
}

/** One 1-token request. Never throws. */
export async function probeAi(apiKey: string | undefined, model: string = everydayModel()): Promise<AiStatus> {
  const at = new Date().toISOString()
  if (!apiKey) return { ok: false, why: 'no AI key is set (ANTHROPIC_API_KEY)', model, at }
  try {
    const client = new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 })
    await client.messages.create({ model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] })
    return { ok: true, why: null, model, at }
  } catch (err) {
    return { ok: false, why: aiErrorCategory(err), model, at }
  }
}

/** Overload and rate limits pass on their own — they are not worth a page. */
export function isTransient(status: AiStatus): boolean {
  return !status.ok && /overloaded|rate-limiting|outage|couldn’t reach/.test(status.why ?? '')
}

/** What the founder feed says when the verdict flips. */
export function aiStatusNotice(prev: AiStatus | null, now: AiStatus): { title: string; body: string } | null {
  if (now.ok) {
    if (prev && !prev.ok) return { title: 'Ask AI is answering again', body: `The Claude API answered (${now.model}). Ask AI, digests and the memo are back on the model.` }
    return null
  }
  if (isTransient(now)) return null
  if (prev && !prev.ok && prev.why === now.why) return null
  const fix = /credits/.test(now.why ?? '')
    ? 'Fix: console.anthropic.com → the organization that owns the HammerTrack key → Billing → buy credits and turn on auto-reload. No redeploy needed.'
    : /refused|no AI key/.test(now.why ?? '')
      ? 'Fix: make a key in the funded Anthropic organization and set ANTHROPIC_API_KEY on the hammertrackjune28 project in Vercel (Production + Preview), then redeploy.'
      : /model name/.test(now.why ?? '')
        ? `Fix: set AI_MODEL in Vercel to a current model id (it is "${now.model}").`
        : 'Ask AI answers from the built-in engine until it clears.'
  return { title: 'Ask AI is down', body: `The Claude API check failed: ${now.why}. ${fix}` }
}
