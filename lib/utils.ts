import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function formatRelativeTime(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date) : date
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  if (diffMins < 1) return 'Just now'
  if (diffMins < 60) return `${diffMins}m ago`
  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`
  return `${Math.floor(diffHours / 24)}d ago`
}

export function generateApiKey(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  // This key now authenticates the direct ingest API per-company, so use CSPRNG
  // randomness where the runtime has it (all modern browsers + Node ≥19 expose
  // globalThis.crypto). Math.random stays only as a last-resort fallback.
  const webCrypto = globalThis.crypto
  if (webCrypto?.getRandomValues) {
    const buf = new Uint32Array(40)
    webCrypto.getRandomValues(buf)
    return 'tf_' + Array.from(buf, (n) => chars[n % chars.length]).join('')
  }
  return 'tf_' + Array.from({ length: 40 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}
