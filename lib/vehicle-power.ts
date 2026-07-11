/**
 * Engine state + 12V battery health from OBD telemetry (see
 * docs/TRACKER-DATA.md). external.powersource.voltage reads ~12.6 V with the
 * engine off and ~14 V while running — a free "engine running" signal and a
 * dead-battery early warning on every ping.
 */

export interface VehiclePower {
  /** Vehicle battery voltage (V), null if the ECU didn't serve it. */
  volts: number | null
  /** True = engine running; null = can't tell from this ping. */
  engineOn: boolean | null
  /** Resting-battery health — only meaningful with the engine OFF
   *  (alternator voltage masks the battery while running). */
  health: 'good' | 'weak' | 'low' | null
}

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null

export function vehiclePower(raw: unknown): VehiclePower {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>

  let volts = num(r['external.powersource.voltage'])
  if (volts != null && volts > 1000) volts = volts / 1000 // devices that report mV
  if (volts != null) volts = Math.round(volts * 10) / 10

  // Best signal wins: explicit ignition flag → RPM → charging voltage.
  const ign = r['engine.ignition.status']
  const rpm = num(r['obd.rpm']) ?? num(r['can.engine.rpm'])
  const engineOn =
    typeof ign === 'boolean' ? ign
    : ign === 1 || ign === 0 ? ign === 1
    : rpm != null ? rpm > 300
    : volts != null ? volts >= 13.2
    : null

  // 12.4+ resting = healthy; 11.9–12.4 = getting weak; under 11.9 = won't
  // start much longer. Skip the verdict while charging voltage is present.
  const health = volts == null || engineOn ? null
    : volts >= 12.4 ? 'good'
    : volts >= 11.9 ? 'weak'
    : 'low'

  return { volts, engineOn, health }
}
