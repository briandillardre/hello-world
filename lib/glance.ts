/**
 * When a device counts as DARK — one answer for every glance surface: the
 * map dot's color and ring, the cluster sheet's state word, the Today card's
 * "silent" row, the trackers list's last-seen tone.
 *
 * Brian, Sep 19, of the Charleston RAM sitting "No signal · 24h ago" under a
 * bright blue dot: "This should show gray or something for devices that have
 * not been seen in quite a while." The old ladder (Sep 4) faded 12 h → 48 h,
 * so a day-old fix was still two-thirds its own color — and the health cron
 * had been calling that same unit silent since hour six. The map now agrees
 * with the watchdog: the fade STARTS where the cron starts worrying (6 h),
 * and a device nobody has heard from in a day is gray, full stop. Every
 * hardware unit checks in hourly even asleep, so 24 h of nothing is the
 * hardware being dark (unplugged, dead battery, no coverage), never a parked
 * machine.
 */
export const FADE_FROM_H = 6
export const DEAD_H = 24
export const DEAD_MS = DEAD_H * 3_600_000
export const DEAD_GRAY = '#46586a'
