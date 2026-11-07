import type { Config } from 'tailwindcss'

const config: Config = {
  // hover: styles only on devices that can actually hover — phones kept the
  // last-tapped element painted in its hover state ("stays highlighted",
  // Brian, Aug 22). Touch never sees hover styles now; desktop unchanged.
  future: { hoverOnlyWhenSupported: true },
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        // HammerTrack brand — navy #002946 extracted from the logo
        navy: {
          DEFAULT: '#002946',
          950: '#001523',
          900: '#00203a',
          850: '#002946',
          800: '#073a5a',
          700: '#14506f',
          600: '#1f6488',
        },
        ink: '#e8f0f7',
        muted: '#9fb6cc',
        faint: '#6f88a0',
        amber: {
          DEFAULT: '#ff9e16',
          500: '#ff9e16',
          600: '#e8870a',
        },
        teal: {
          DEFAULT: '#2dd4bf',
          500: '#2dd4bf',
        },
        alert: '#fb5d5d',
        // Broadcast red for the timeline's LIVE tag only — the YouTube TV
        // look Brian asked for (Nov 7). Deeper than `alert` so a LIVE tag
        // never reads as an alarm.
        live: '#e62117',
        // keep "brand" alias for any legacy refs
        brand: {
          50: '#fffbeb',
          500: '#ff9e16',
          600: '#e8870a',
          900: '#002946',
        },
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', 'sans-serif'],
        display: ['var(--font-archivo)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'glow-amber': '0 10px 30px -8px rgba(255,158,22,.5)',
        'glow-teal': '0 0 22px -4px rgba(45,212,191,.45)',
        'glow-live': '0 0 14px -3px rgba(230,33,23,.8)',
        panel: '0 50px 100px -40px rgba(0,0,0,.85)',
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
      },
      keyframes: {
        'pulse-ring': {
          '0%': { boxShadow: '0 0 0 0 rgba(251,93,93,.45)' },
          '70%': { boxShadow: '0 0 0 12px rgba(251,93,93,0)' },
          '100%': { boxShadow: '0 0 0 0 rgba(251,93,93,0)' },
        },
        blink: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '.3' },
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 1.6s infinite',
        blink: 'blink 1.6s infinite',
      },
    },
  },
  plugins: [],
}

export default config
