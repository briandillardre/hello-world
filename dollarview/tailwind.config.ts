import type { Config } from 'tailwindcss'

// Tokens follow the validated dataviz reference palette (light mode).
const config: Config = {
  content: [
    './app/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './lib/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        surface: '#fcfcfb', // chart surface
        plane: '#f9f9f7', // page plane
        ink: '#0b0b0b', // primary ink
        ink2: '#52514e', // secondary ink
        muted: '#898781', // axis/labels
        grid: '#e1e0d9', // hairline gridline
        baseline: '#c3c2b7', // axis baseline
        brand: '#2a78d6', // categorical slot 1 (blue)
        branddeep: '#1c5cab',
        good: '#0ca30c',
        warning: '#fab219',
        serious: '#ec835a',
        critical: '#d03b3b',
        gooddark: '#006300', // success text on light surface
      },
      fontFamily: {
        sans: ['var(--font-inter)', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      maxWidth: {
        page: '72rem',
      },
    },
  },
  plugins: [],
}

export default config
