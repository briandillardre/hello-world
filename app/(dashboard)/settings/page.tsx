import type { ReactNode } from 'react'
import Link from 'next/link'
import { Key, Map, Package, Wifi, Calculator } from 'lucide-react'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default function SettingsPage() {
  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-0">
      <div className="p-4 border-b border-navy-800 bg-navy-950/95 backdrop-blur sticky top-0 z-10">
        <h1 className="text-xl font-bold text-ink">Settings</h1>
      </div>

      <div className="p-4 space-y-4 max-w-xl">
        {/* Company info */}
        <section className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
            <Package className="h-4 w-4 text-faint" />
            <h2 className="font-semibold text-sm text-muted">Company</h2>
          </div>
          <div className="p-4 space-y-3">
            <Row label="Company Name" value={MOCK_COMPANY.name} />
            <Separator />
            <Row label="Plan" value={<Badge>{MOCK_COMPANY.plan}</Badge>} />
          </div>
        </section>

        {/* API Key */}
        <section className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
            <Key className="h-4 w-4 text-faint" />
            <h2 className="font-semibold text-sm text-muted">Tracker API Key</h2>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-muted">Use this key to authenticate tracker hardware pushing location data.</p>
            <div className="bg-navy-800 rounded-lg px-3 py-2 font-mono text-xs text-muted break-all select-all border border-navy-800">
              {MOCK_COMPANY.api_key}
            </div>
            <div className="bg-amber/15 border border-navy-800 rounded-lg p-3 text-xs text-amber">
              <p className="font-semibold mb-1">How to use with OBD2 trackers</p>
              <p>Send a POST request to <code className="bg-amber/15 px-1 rounded">/api/ingest/location</code> with header <code className="bg-amber/15 px-1 rounded">x-api-key: YOUR_KEY</code></p>
            </div>
          </div>
        </section>

        {/* Integration guide */}
        <section className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
            <Wifi className="h-4 w-4 text-faint" />
            <h2 className="font-semibold text-sm text-muted">Tracker Integration</h2>
          </div>
          <div className="p-4 space-y-4">
            <IntegrationCard
              title="OBD2 (Vehicles)"
              description="Use any OBD2 WiFi/BLE dongle that supports HTTP webhooks (e.g. Bouncie, AutoPi, Optimus 2.0). Configure the device to POST to /api/ingest/obd2."
              endpoint="POST /api/ingest/obd2"
              payload='{ "tracker_id": "obd-001", "lat": 36.16, "lng": -86.78, "speed": 45, "engine_on": true }'
            />
            <IntegrationCard
              title="GPS Equipment Trackers"
              description="Calamp, SkyBell, Teltonika, or similar fleet trackers. Use the standard location endpoint."
              endpoint="POST /api/ingest/location"
              payload='{ "tracker_id": "gps-002", "lat": 36.16, "lng": -86.78, "battery": 85 }'
            />
            <IntegrationCard
              title="Bluetooth Tools (BLE)"
              description="Tile, AirTag-style or custom BLE tags. A companion mobile app scans nearby BLE and relays positions."
              endpoint="POST /api/ingest/location"
              payload='{ "tracker_id": "bt-003", "lat": 36.16, "lng": -86.78, "accuracy": 15 }'
            />
          </div>
        </section>

        {/* QuickBooks */}
        <section className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
            <Calculator className="h-4 w-4 text-faint" />
            <h2 className="font-semibold text-sm text-muted">QuickBooks Online</h2>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-muted">
              Sync assets as fixed assets, push equipment-usage invoices per job site, and record
              service costs as expenses — automatically.
            </p>
            <div className="flex gap-2">
              <Link href="/accounting" className="flex-1">
                <span className="block text-center text-sm font-medium bg-amber text-[#1a1100] rounded-lg py-2.5 hover:bg-amber-600 transition-colors">
                  Open Accounting
                </span>
              </Link>
              <a href="/api/qbo/connect" className="flex-1">
                <span className="block text-center text-sm font-medium border border-navy-800 text-muted rounded-lg py-2.5 hover:bg-navy-800 transition-colors">
                  Connect QuickBooks
                </span>
              </a>
            </div>
          </div>
        </section>

        {/* Map provider */}
        <section className="bg-navy-900 rounded-xl border border-navy-800 overflow-hidden">
          <div className="px-4 py-3 border-b border-navy-800 flex items-center gap-2">
            <Map className="h-4 w-4 text-faint" />
            <h2 className="font-semibold text-sm text-muted">Map Provider</h2>
          </div>
          <div className="p-4 space-y-2">
            <Row
              label="Tile Source"
              value={process.env.NEXT_PUBLIC_MAPTILER_KEY && process.env.NEXT_PUBLIC_MAPTILER_KEY !== 'YOUR_MAPTILER_KEY'
                ? <Badge variant="success">Maptiler</Badge>
                : <Badge variant="secondary">CARTO (free)</Badge>}
            />
            <p className="text-xs text-faint">Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to enable Maptiler Streets.</p>
          </div>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-sm font-medium text-muted">{value}</span>
    </div>
  )
}

function IntegrationCard({ title, description, endpoint, payload }: {
  title: string; description: string; endpoint: string; payload: string
}) {
  return (
    <div className="border border-navy-800 rounded-lg p-3 space-y-2">
      <p className="font-semibold text-sm text-muted">{title}</p>
      <p className="text-xs text-muted">{description}</p>
      <div className="bg-navy-950 rounded-md p-2 space-y-1">
        <p className="text-xs font-mono text-amber">{endpoint}</p>
        <p className="text-xs font-mono text-faint break-all">{payload}</p>
      </div>
    </div>
  )
}
