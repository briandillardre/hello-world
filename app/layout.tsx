import type { Metadata, Viewport } from 'next'
import { Inter, Archivo, JetBrains_Mono } from 'next/font/google'
import './globals.css'
import { BRAND_NAME, BRAND_URL } from '@/lib/brand'

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
  title: `${BRAND_NAME} — AI asset tracking for contractors & field fleets`,
  description:
    'Every truck, machine, crew, and Bluetooth-tagged tool on one live map. AI texts you the second something moves when it shouldn\'t. Half the price of the big telematics platforms.',
  manifest: '/manifest.json',
  appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: BRAND_NAME },
  icons: {
    icon: '/icons/icon-192.png',
    apple: '/icons/icon-192.png',
  },
  openGraph: {
    title: `${BRAND_NAME} — your whole fleet on one live map`,
    description:
      'AI-watched GPS tracking for trucks, equipment, crews, and tools. After-hours theft texts, live job cost, QuickBooks built in.',
    url: BRAND_URL,
    siteName: BRAND_NAME,
    images: [{ url: '/brand/hammertrack-lockup.png', width: 1200, height: 630, alt: BRAND_NAME }],
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: `${BRAND_NAME} — your whole fleet on one live map`,
    description: 'AI-watched GPS tracking for trucks, equipment, crews, and tools.',
    images: ['/brand/hammertrack-lockup.png'],
  },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: '#002946',
}

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
      <body className="font-sans">{children}</body>
    </html>
  )
}
