/**
 * One random id per phone (browser profile / app install), kept in
 * localStorage — never the hardware id, never anything Android hands out.
 * It rides along with clock-in and clock-out so /timecards can say "same
 * phone as <teammate>" (migration 120): two people clocking in from one
 * phone is the buddy-punch tell. Absent storage (private mode, blocked site
 * data) = null, and the entry simply carries no device.
 */
const KEY = 'ht_device_id'
const SHAPE = /^[A-Za-z0-9_-]{8,64}$/

export function getDeviceId(): string | null {
  if (typeof window === 'undefined') return null
  try {
    const have = window.localStorage.getItem(KEY)
    if (have && SHAPE.test(have)) return have
    const fresh = (typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join(''))
    window.localStorage.setItem(KEY, fresh)
    return fresh
  } catch {
    return null
  }
}
