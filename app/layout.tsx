import type { Metadata, Viewport } from 'next'
import { Inter, Archivo, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { BRAND_NAME, BRAND_URL } from '@/lib/brand'
import { ErrorReporter } from '@/components/system/ErrorReporter'
import { NativePush } from '@/components/system/NativePush'
import { FeedbackHost } from '@/components/ui/feedback'
import { Analytics } from '@vercel/analytics/next'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const archivo = Archivo({
  subsets: ['latin'],
  weight: ['600', '700', '800', '900'],
  variable: '--font-archivo',
  display: 'swap',
})
const mono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '600'],
  variable: '--font-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  metadataBase: new URL(BRAND_URL),
  // Per-page canonical (resolves against metadataBase) — until Sep 1 2026 no
  // public page declared one, and Vercel serves the same HTML on the
  // *.vercel.app hostname, so search engines saw duplicates.
  alternates: { canonical: './' },
  title: `${BRAND_NAME} — Asset tracking for contractors & field fleets`,
  description:
    'Every truck, machine, crew, and Bluetooth-tagged tool on one live map. Your phone knows within minutes when something moves that shouldn\'t. About half the price of Tenna.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: BRAND_NAME },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/apple-touch-icon.png',
  },
  openGraph: {
    title: `${BRAND_NAME} — your whole fleet on one live map`,
    description:
      'Always-on GPS tracking for trucks, equipment, crews, and tools. After-hours theft alerts, live job cost, one price.',
    url: BRAND_URL,
    siteName: BRAND_NAME,
    images: [{ url: '/brand/og-card.png', width: 1200, height: 630, alt: BRAND_NAME }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND_NAME} — your whole fleet on one live map`,
    description: 'Always-on GPS tracking for trucks, equipment, crews, and tools.',
    images: ['/brand/og-card.png'],
  },
}

// Accessibility: pinch-zoom stays available everywhere by default. Map-like
// surfaces (/map, /command, /live) pin their own maximumScale:1 viewport so
// gesture handling stays with the map engine.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: '#002946',
  // Lets env(safe-area-inset-*) report real values under an overlaid status
  // bar (the native shell) and iOS notches.
  viewportFit: 'cover',
}

// Vercel Web Analytics loads /_vercel/insights/script.js, which 404s (a console
// error on every page) until the project has Analytics enabled. Flip both in
// one sitting: Vercel → Analytics → Enable, then NEXT_PUBLIC_VERCEL_ANALYTICS=1
// in the project env + redeploy. Board #86.
const analyticsOn = process.env.NEXT_PUBLIC_VERCEL_ANALYTICS === '1'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${archivo.variable} ${mono.variable}`}>
      <head>
        {/* One-time cleanup: kill any stale service worker / cache left on a
            device by an earlier PWA build, which can keep serving an old app
            shell even after new deploys. Harmless when there's nothing to clear. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if('serviceWorker'in navigator){navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister()})}).catch(function(){})}if(typeof caches!=='undefined'&&caches.keys){caches.keys().then(function(ks){ks.forEach(function(k){caches.delete(k)})}).catch(function(){})}}catch(e){}})();`,
          }}
        />
      </head>
      {/* FeedbackHost lives at the ROOT so toast()/confirmSheet() work on
          every surface — /command and /live render MapView outside the
          dashboard layout, and a feedback call nobody hears is a dead
          button (ship-check P0, Aug 12). */}
      <body className="font-sans"><ErrorReporter /><NativePush /><FeedbackHost />{children}{analyticsOn && <Analytics />}</body>
    </html>
  )
}
