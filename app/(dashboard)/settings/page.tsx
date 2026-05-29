import type { ReactNode } from 'react'
import { Key, Map, Package, Wifi } from 'lucide-react'
import { MOCK_COMPANY } from '@/lib/mock-data'
import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'

export default function SettingsPage() {
  return (
    <div className="h-full overflow-auto pb-[70px] md:pb-0">
      <div className="p-4 border-b border-slate-100 bg-white sticky top-0 z-10">
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
      </div>

      <div className="p-4 space-y-4 max-w-xl">
        {/* Company info */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Package className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-sm text-slate-700">Company</h2>
          </div>
          <div className="p-4 space-y-3">
            <Row label="Company Name" value={MOCK_COMPANY.name} />
            <Separator />
            <Row label="Plan" value={<Badge>{MOCK_COMPANY.plan}</Badge>} />
          </div>
        </section>

        {/* API Key */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Key className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-sm text-slate-700">Tracker API Key</h2>
          </div>
          <div className="p-4 space-y-3">
            <p className="text-xs text-slate-500">Use this key to authenticate tracker hardware pushing location data.</p>
            <div className="bg-slate-50 rounded-lg px-3 py-2 font-mono text-xs text-slate-700 break-all select-all border border-slate-200">
              {MOCK_COMPANY.api_key}
            </div>
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
              <p className="font-semibold mb-1">How to use with OBD2 trackers</p>
              <p>Send a POST request to <code className="bg-amber-100 px-1 rounded">/api/ingest/location</code> with header <code className="bg-amber-100 px-1 rounded">x-api-key: YOUR_KEY</code></p>
            </div>
          </div>
        </section>

        {/* Integration guide */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Wifi className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-sm text-slate-700">Tracker Integration</h2>
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

        {/* Map provider */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
          <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-2">
            <Map className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-sm text-slate-700">Map Provider</h2>
          </div>
          <div className="p-4 space-y-2">
            <Row
              label="Tile Source"
              value={process.env.NEXT_PUBLIC_MAPTILER_KEY && process.env.NEXT_PUBLIC_MAPTILER_KEY !== 'YOUR_MAPTILER_KEY'
                ? <Badge variant="success">Maptiler</Badge>
                : <Badge variant="secondary">CARTO (free)</Badge>}
            />
            <p className="text-xs text-slate-400">Set NEXT_PUBLIC_MAPTILER_KEY in .env.local to enable Maptiler Streets.</p>
          </div>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm text-slate-500">{label}</span>
      <span className="text-sm font-medium text-slate-800">{value}</span>
    </div>
  )
}

function IntegrationCard({ title, description, endpoint, payload }: {
  title: string; description: string; endpoint: string; payload: string
}) {
  return (
    <div className="border border-slate-100 rounded-lg p-3 space-y-2">
      <p className="font-semibold text-sm text-slate-800">{title}</p>
      <p className="text-xs text-slate-500">{description}</p>
      <div className="bg-slate-800 rounded-md p-2 space-y-1">
        <p className="text-xs font-mono text-amber-400">{endpoint}</p>
        <p className="text-xs font-mono text-slate-300 break-all">{payload}</p>
      </div>
    </div>
  )
}
