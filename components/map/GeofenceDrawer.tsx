'use client'

import { useState } from 'react'
import { Hexagon, X, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'

const COLORS = ['#F59E0B', '#3B82F6', '#10B981', '#EF4444', '#8B5CF6', '#EC4899']

interface GeofenceDrawerProps {
  isDrawing: boolean
  onStartDraw: () => void
  onFinishDraw: () => GeoJSON.Polygon | null
  onCancelDraw: () => void
  onSave?: (name: string, geometry: GeoJSON.Polygon, color: string) => void
}

export function GeofenceDrawer({
  isDrawing,
  onStartDraw,
  onFinishDraw,
  onCancelDraw,
  onSave,
}: GeofenceDrawerProps) {
  const [showDialog, setShowDialog] = useState(false)
  const [pendingGeom, setPendingGeom] = useState<GeoJSON.Polygon | null>(null)
  const [name, setName] = useState('')
  const [color, setColor] = useState(COLORS[0])

  const handleFinish = () => {
    const geom = onFinishDraw()
    if (!geom) {
      alert('Draw at least 3 points to create a geofence.')
      return
    }
    setPendingGeom(geom)
    setShowDialog(true)
  }

  const handleSave = () => {
    if (!pendingGeom || !name.trim()) return
    onSave?.(name.trim(), pendingGeom, color)
    setShowDialog(false)
    setName('')
    setPendingGeom(null)
  }

  return (
    <>
      <div className="absolute bottom-[80px] right-3 z-10 flex flex-col gap-2 md:bottom-6">
        {isDrawing ? (
          <>
            <button
              onClick={handleFinish}
              className="flex items-center justify-center w-12 h-12 bg-green-500 text-white rounded-full shadow-lg hover:bg-green-600 transition-colors"
              title="Finish geofence"
            >
              <Check className="h-5 w-5" />
            </button>
            <button
              onClick={onCancelDraw}
              className="flex items-center justify-center w-12 h-12 bg-red-500 text-white rounded-full shadow-lg hover:bg-red-600 transition-colors"
              title="Cancel"
            >
              <X className="h-5 w-5" />
            </button>
          </>
        ) : (
          <button
            onClick={onStartDraw}
            className="flex items-center justify-center w-12 h-12 bg-slate-900 text-white rounded-full shadow-lg hover:bg-slate-700 transition-colors"
            title="Draw geofence"
          >
            <Hexagon className="h-5 w-5" />
          </button>
        )}
      </div>

      {isDrawing && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 z-10 bg-slate-900 text-white text-sm px-4 py-2 rounded-full shadow-lg pointer-events-none">
          Click to add points • ✓ to finish • ✕ to cancel
        </div>
      )}

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Geofence</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="fence-name">Zone name</Label>
              <Input
                id="fence-name"
                placeholder="e.g. Main Site, Equipment Yard"
                value={name}
                onChange={e => setName(e.target.value)}
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Color</Label>
              <div className="flex gap-2">
                {COLORS.map(c => (
                  <button
                    key={c}
                    onClick={() => setColor(c)}
                    className="w-8 h-8 rounded-full border-2 transition-transform hover:scale-110"
                    style={{
                      backgroundColor: c,
                      borderColor: color === c ? '#0F172A' : 'transparent',
                    }}
                  />
                ))}
              </div>
            </div>
            <div className="flex gap-3 pt-2">
              <Button variant="outline" onClick={() => setShowDialog(false)} className="flex-1">
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!name.trim()} className="flex-1">
                Save Zone
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
