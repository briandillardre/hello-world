import type { Metadata, Viewport } from 'next'
import { PlayApp } from '@/components/game/PlayApp'

export const metadata: Metadata = {
  title: 'Brain Ball — roll, answer, grow!',
  description:
    'A kindergarten-readiness game: roll your ball into the right answer and watch it grow. Adaptive difficulty, coins & ball skins, and a grown-ups progress report.',
  robots: { index: false, follow: false },
  manifest: '/brainball.webmanifest',
  appleWebApp: { capable: true, statusBarStyle: 'default', title: 'Brain Ball' },
  icons: { icon: '/icons/brainball-192.png', apple: '/icons/brainball-192.png' },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: 'cover', // draw behind the notch; safe-area insets handled in the shell
  themeColor: '#bae6fd',
}

export default function PlayPage() {
  return <PlayApp />
}
