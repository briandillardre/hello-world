'use client'

import {
  Sun, Moon, CloudSun, CloudMoon, Cloud, CloudRain, CloudSunRain, CloudMoonRain, CloudDrizzle,
  CloudLightning, CloudSnow, CloudFog, Wind, Haze, type LucideIcon,
} from 'lucide-react'

/**
 * One weather glyph with a day AND a night face (Brian, Sep 4: "sun … should
 * auto change to moon after sunset and have night and day versions of
 * cloudy, partly cloudy, stormy, windy, snow, fog, haze").
 *
 * Open-Meteo's `is_day` (computed from sunrise/sunset at the queried point)
 * picks the face; the WMO code picks the shape; sustained wind overrides a
 * calm shape with the wind glyph. Where lucide has a true night variant
 * (moon, cloud-moon, cloud-moon-rain) it is used; for the rest the shape is
 * the same and the PALETTE turns night — cool slate-blue instead of warm
 * amber/sky — which is how phone weather apps do it too.
 */
export function WeatherIcon({ code, isDay, windMph = 0, className = 'h-4 w-4' }: {
  code: number; isDay: boolean; windMph?: number; className?: string
}) {
  const { Icon, tone } = pick(code, isDay, windMph)
  return <Icon className={`${className} ${tone}`} aria-hidden />
}

const DAY = { sky: 'text-[#fbbf24]', cloud: 'text-[#cbd5e1]', wet: 'text-[#60a5fa]', storm: 'text-[#f59e0b]', snow: 'text-[#e0f2fe]', fog: 'text-[#94a3b8]' }
const NIGHT = { sky: 'text-[#c7d2fe]', cloud: 'text-[#94a3b8]', wet: 'text-[#818cf8]', storm: 'text-[#a5b4fc]', snow: 'text-[#c7d2fe]', fog: 'text-[#64748b]' }

function pick(code: number, isDay: boolean, windMph: number): { Icon: LucideIcon; tone: string } {
  const t = isDay ? DAY : NIGHT
  if ([95, 96, 99].includes(code)) return { Icon: CloudLightning, tone: t.storm }
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { Icon: CloudSnow, tone: t.snow }
  if ([61, 63, 65, 66, 67, 81, 82].includes(code)) return { Icon: CloudRain, tone: t.wet }
  if ([51, 53, 55, 56, 57].includes(code)) return { Icon: CloudDrizzle, tone: t.wet }
  if (code === 80) return { Icon: isDay ? CloudSunRain : CloudMoonRain, tone: t.wet }
  if (code === 45) return { Icon: CloudFog, tone: t.fog }
  if (code === 48) return { Icon: Haze, tone: t.fog }
  // Calm shapes give way to the wind glyph when it is actually blowing.
  if (windMph >= 20) return { Icon: Wind, tone: t.cloud }
  if (code === 3) return { Icon: Cloud, tone: t.cloud }
  if ([1, 2].includes(code)) return { Icon: isDay ? CloudSun : CloudMoon, tone: isDay ? t.sky : t.cloud }
  if (code === 0) return { Icon: isDay ? Sun : Moon, tone: t.sky }
  return { Icon: isDay ? Sun : Moon, tone: t.sky }
}

/** Plain-words label for tooltips and screen readers. */
export function weatherWords(code: number, isDay: boolean, windMph = 0): string {
  if ([95, 96, 99].includes(code)) return 'Thunderstorms'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if (code === 45) return 'Fog'
  if (code === 48) return 'Haze'
  if (windMph >= 20) return 'Windy'
  if (code === 3) return 'Overcast'
  if ([1, 2].includes(code)) return isDay ? 'Partly sunny' : 'Partly cloudy'
  return isDay ? 'Sunny' : 'Clear'
}
