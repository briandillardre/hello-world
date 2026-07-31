/**
 * The ONE color palette behind every picker — zones (draw dialog, map panel,
 * zone editor) and assets (dot/trail/radar). The three zone pickers had
 * drifted to three different swatch sets ("need better color selection" —
 * owner, Jul 31); this is the fix plus a native custom-color option in the
 * shared component (components/ui/color-swatches).
 *
 * Hue-ordered around the wheel so the row reads intentional. Legacy hexes
 * from the old pickers stay in the set so existing zones/assets still show
 * as selected. All steps sit bright enough to read on the dark navy AND on
 * satellite imagery. Black + gray remain last — the classic outline colors
 * for boundary perimeters (kind-less legacy zones infer 'boundary' from
 * exactly these two, so they must keep existing).
 */
export const PICKER_COLORS = [
  '#ff9e16', // HammerTrack amber
  '#F59E0B', // construction gold (legacy default)
  '#f97316', // orange
  '#facc15', // yellow
  '#a3e635', // lime
  '#10B981', // green (legacy)
  '#2dd4bf', // teal
  '#22d3ee', // cyan
  '#60a5fa', // sky
  '#3B82F6', // blue (legacy)
  '#818cf8', // indigo
  '#8B5CF6', // violet (legacy)
  '#d946ef', // fuchsia
  '#EC4899', // pink (legacy)
  '#fb7185', // rose
  '#EF4444', // red (legacy)
  '#e2e8f0', // bright slate — pops on satellite
  '#9ca3af', // gray outline (legacy boundary)
  '#0a0a0a', // black outline (legacy boundary)
]
