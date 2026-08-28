import { TrackerScan } from '@/components/assets/TrackerScan'

export const metadata = { title: 'HammerTrack — Scan trackers' }

/** Scan-to-map: unbox → scan the IMEI barcode → the asset exists and shows
 *  up on the map at first report. The batch answer to per-device setup pain. */
export default function ScanPage() {
  return <TrackerScan />
}
