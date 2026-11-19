'use client'

/**
 * Driver vehicle inspections on the phone (49 CFR 396.11 / 396.13): pick the
 * truck, tap anything wrong (minor or out of service, with a note), sign
 * with a finger. Every defect opens a work order on the truck; an
 * out-of-service one marks it DO NOT OPERATE until a foreman or mechanic
 * certifies the repair, and the next driver signs that they saw it.
 * In Spanish when the phone is set to it.
 */
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { DVIR_ITEMS, dvirStatus, itemLabel, type Defect, type Dvir } from '@/lib/beta/dvir'
import { certifyDvirAction, fileDvirAction, reviewDvirAction } from '@/lib/actions/beta'
import type { BetaRecord } from '@/lib/db/beta'
import { useLang } from '@/lib/i18n'
import { SignatureMark, SignaturePad } from '@/components/safety/SignaturePad'
import { BetaPage, Notice, StatePill, box, btn, card, primary } from './ui'

type Opt = { id: string; name: string; type: string }

export function DvirView({ assets, rows, demo, canWrite, canCertify }: { assets: Opt[]; rows: BetaRecord[]; demo: boolean; canWrite: boolean; canCertify: boolean }) {
  const router = useRouter()
  const { t } = useLang()
  const vehicles = assets.filter((a) => a.type === 'vehicle')
  const [assetId, setAsset] = useState('')
  const [when, setWhen] = useState<'pre' | 'post'>('pre')
  const [odometer, setOdo] = useState('')
  const [trailer, setTrailer] = useState('')
  const [defects, setDefects] = useState<Defect[]>([])
  const [sig, setSig] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const name = useMemo(() => new Map(assets.map((a) => [a.id, a.name])), [assets])
  const items = DVIR_ITEMS.filter((i) => trailer.trim() || !i.trailer)
  const unsafeNow = new Map<string, BetaRecord>()
  for (const r of rows) { const s = dvirStatus(r.data as unknown as Dvir); if (s.state === 'unsafe' && r.assetId && !unsafeNow.has(r.assetId)) unsafeNow.set(r.assetId, r) }

  const toggle = (key: string) => setDefects((d) => (d.some((x) => x.item === key) ? d.filter((x) => x.item !== key) : [...d, { item: key, severity: 'minor', note: '' }]))
  const patch = (key: string, p: Partial<Defect>) => setDefects((d) => d.map((x) => (x.item === key ? { ...x, ...p } : x)))

  async function file() {
    setErr(null); setNote(null)
    if (!assetId) { setErr(t('Vehicle') + '?'); return }
    setBusy('file')
    const r = await fileDvirAction({ assetId, report: { when, odometer: odometer || undefined, trailer: trailer || undefined, defects, signature: sig } }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || 'Couldn’t file — check your signal and try again.'); return }
    setNote(r.unsafe ? `Filed. OUT OF SERVICE — ${r.workOrders} work ${r.workOrders === 1 ? 'order' : 'orders'} opened; don’t drive it until it’s signed off.` : r.workOrders ? `Filed. ${r.workOrders} work ${r.workOrders === 1 ? 'order' : 'orders'} opened.` : t('No defects — safe to operate'))
    setDefects([]); setSig(''); setOdo(''); setTrailer('')
    router.refresh()
  }
  async function act(key: string, fn: () => Promise<{ ok: boolean; error?: string } | null | undefined>) {
    setBusy(key); setErr(null)
    const r = await fn().catch(() => null)
    setBusy(null)
    if (!r?.ok) setErr((r && 'error' in r && r.error) || 'Couldn’t save — try again.')
    else router.refresh()
  }

  return (
    <BetaPage title={t('Truck inspections (DVIR)')} icon={<ClipboardCheck className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb={t('Pre- and post-trip inspections, signed on the phone. Every defect opens a work order; out-of-service ones say DO NOT OPERATE until someone signs off the repair.')}>
      {unsafeNow.size > 0 && <Notice tone="bad">Out of service: {Array.from(unsafeNow.keys()).map((id) => name.get(id) ?? 'a truck').join(', ')}</Notice>}
      {canWrite && (
        <div className={`${card} space-y-3`}>
          <div className="grid grid-cols-2 gap-1 rounded-xl border border-navy-800 bg-navy-950 p-1">
            {(['pre', 'post'] as const).map((w) => <button key={w} type="button" onClick={() => setWhen(w)} className={'rounded-lg py-2 font-semibold ' + (when === w ? 'bg-amber text-navy-950' : 'text-muted')}>{t(w === 'pre' ? 'Pre-trip' : 'Post-trip')}</button>)}
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <label className="min-w-0"><span className="text-faint text-[12px] block">{t('Vehicle')}</span>
              <select className={box} value={assetId} onChange={(e) => setAsset(e.target.value)}>
                <option value="">—</option>
                {vehicles.map((a) => <option key={a.id} value={a.id}>{a.name}{unsafeNow.has(a.id) ? ' ⚠' : ''}</option>)}
              </select></label>
            <label><span className="text-faint text-[12px] block">{t('Odometer')}</span><input inputMode="numeric" className={box} value={odometer} onChange={(e) => setOdo(e.target.value.replace(/[^\d]/g, ''))} /></label>
            <label><span className="text-faint text-[12px] block">{t('Trailer (if hooked up)')}</span><input className={box} value={trailer} maxLength={60} onChange={(e) => setTrailer(e.target.value)} /></label>
          </div>
          {assetId && unsafeNow.has(assetId) && <Notice tone="bad">This truck was put out of service on its last inspection and hasn’t been signed off.</Notice>}
          <p className="text-muted">{t('Tap anything that is wrong')}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {items.map((i) => {
              const d = defects.find((x) => x.item === i.key)
              return (
                <div key={i.key} className={'rounded-lg border px-2.5 py-2 ' + (d ? (d.severity === 'oos' ? 'border-red-400/60 bg-red-950/30' : 'border-amber/50 bg-amber/5') : 'border-navy-800')}>
                  <button type="button" className="w-full text-left text-ink" onClick={() => toggle(i.key)}>{d ? '✕ ' : '✓ '}{t(i.label)}</button>
                  {d && (
                    <div className="mt-1.5 space-y-1.5">
                      <div className="flex gap-1">
                        {(['minor', 'oos'] as const).map((s) => <button key={s} type="button" onClick={() => patch(i.key, { severity: s })} className={'min-h-10 rounded-md px-3 text-[13px] ' + (d.severity === s ? (s === 'oos' ? 'bg-red-500 text-white' : 'bg-amber text-navy-950') : 'border border-navy-700 text-muted')}>{t(s === 'oos' ? 'Out of service' : 'Minor')}</button>)}
                      </div>
                      <input className={box} placeholder={t('What is wrong?')} value={d.note} maxLength={400} onChange={(e) => patch(i.key, { note: e.target.value })} />
                    </div>
                  )}
                </div>
              )
            })}
          </div>
          <div>
            <p className="text-faint text-[12px] mb-1">{t('Sign here')}</p>
            <SignaturePad value={sig} onChange={setSig} />
          </div>
          {err && <Notice tone="bad">{err}</Notice>}
          {note && <Notice tone={/OUT OF SERVICE/.test(note) ? 'bad' : 'good'}>{note}</Notice>}
          <button type="button" className={primary} disabled={busy === 'file'} onClick={file}>{busy === 'file' ? t('Filing…') : t('File inspection')}</button>
        </div>
      )}
      <div className="space-y-2">
        {rows.slice(0, 60).map((r) => {
          const d = r.data as unknown as Dvir
          const s = dvirStatus(d)
          return (
            <div key={r.id} className={`${card} space-y-1.5`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{name.get(r.assetId ?? '') ?? 'Vehicle'} <span className="font-normal text-muted">· {t(d.when === 'post' ? 'Post-trip' : 'Pre-trip')} · {new Date(d.signedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span></p>
                  <p className="text-faint text-[12px]">{d.driverName}{d.odometer ? ` · ${d.odometer.toLocaleString('en-US')} mi` : ''}{d.trailer ? ` · trailer ${d.trailer}` : ''}</p>
                </div>
                <span className="flex items-center gap-2"><SignatureMark d={d.signature} /><StatePill state={s.state === 'unsafe' ? 'bad' : s.state === 'minor' ? 'soon' : 'ok'}>{s.state === 'ok' ? t(s.words) : s.words}</StatePill></span>
              </div>
              {d.defects.map((x) => <p key={x.item} className={x.severity === 'oos' ? 'text-red-300' : 'text-amber'}>• {t(itemLabel(x.item))}{x.note ? ` — ${x.note}` : ''}</p>)}
              {d.defects.length > 0 && !d.repair && canCertify && (
                <div className="flex flex-wrap gap-2">
                  <button type="button" className={btn} disabled={!!busy} onClick={() => act(r.id, () => certifyDvirAction({ id: r.id, outcome: 'repaired' }))}>{t('Certify repaired')}</button>
                  <button type="button" className={btn} disabled={!!busy} onClick={() => act(r.id, () => certifyDvirAction({ id: r.id, outcome: 'not_needed' }))}>{t('Repair not needed')}</button>
                </div>
              )}
              {d.repair && !d.reviewedBy && canWrite && (
                <button type="button" className={btn} disabled={!!busy} onClick={() => act(r.id, () => reviewDvirAction({ id: r.id }))}>{t('I’m the next driver — I saw the sign-off')}</button>
              )}
            </div>
          )
        })}
      </div>
    </BetaPage>
  )
}
