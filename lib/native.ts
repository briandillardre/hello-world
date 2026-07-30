/**
 * Native-shell detection.
 *
 * The Capacitor app loads hammertrack.ai remotely rather than bundling the
 * web build, so the SAME page runs in a browser and inside the app. Anything
 * that needs a native capability has to ask at runtime instead of assuming —
 * and has to degrade to something honest on the web, not a button that
 * silently does nothing.
 */

interface CapacitorGlobal {
  isNativePlatform?: () => boolean
  getPlatform?: () => string
}

function cap(): CapacitorGlobal | undefined {
  if (typeof window === 'undefined') return undefined
  return (window as unknown as { Capacitor?: CapacitorGlobal }).Capacitor
}

/** True only inside the iOS/Android shell — false in every browser. */
export function isNativeApp(): boolean {
  return cap()?.isNativePlatform?.() === true
}

/** 'ios' | 'android' | 'web'. */
export function nativePlatform(): string {
  return cap()?.getPlatform?.() ?? 'web'
}
