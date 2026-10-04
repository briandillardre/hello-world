/**
 * The size and range caps every saved takeoff design is held to — the schema
 * (./schema.ts) enforces them before a write, the plan import fits itself
 * inside them. No imports, so the pure modules and the harnesses share them.
 */
export const MAX_FEATURES = 3000
export const MAX_POINTS_PER_FEATURE = 6000
export const MAX_POINTS_TOTAL = 80000
/** Everything traced must fit in a box this many degrees across (~5 km). */
export const MAX_SPAN_DEG = 0.05
/** The elevations a design may carry, feet. */
export const Z_MIN = -1500
export const Z_MAX = 30000
