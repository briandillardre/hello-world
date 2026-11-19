'use client'

/**
 * The weather-delay packet: pick the site and the window, and HammerTrack
 * reads the weather at the site day by day (Open-Meteo's archive) against
 * the hours our machines and crew logged there. A day is claimed only when
 * the weather crossed the line AND the work actually stopped; the contract's
 * anticipated weather days come off the top. Out as a letter + evidence PDF
 * and the day-by-day spreadsheet.
 */
import { useMemo, useState } from 'react'
import { CloudRain, FileDown, FileSpreadsheet } from 'lucide-react'
import { DEFAULT_THRESHOLDS, claimDays, claimLetter, judgeDays, type Thresholds, type WxDay } from '@/lib/beta/weather'
import { weatherPacketAction, type WeatherPacket } from '@/lib/actions/beta'
import { BetaPage, Notice, StatePill, box, btn, card, deliverDoc, fileSlug, fmtDay, primary, xlsxBlob } from './ui'

type Opt = { id: string; name: string }

export function WeatherView({ sites, defaultFrom, defaultTo, demo, canRun }: { sites: Opt[]; defaultFrom: string; defaultTo: string; demo: boolean; canRun: boolean }) {
  const [siteId, setSite] = useState(sites[0]?.id ?? '')
  const [from, setFrom] = useState(defaultFrom)
  const [to, setTo] = useState(defaultTo)
  const [th, setTh] = useState<Thresholds>(DEFAULT_THRESHOLDS)
  const [anticipated, setAnt] = useState<Record<string, number>>({})
  const [packet, setPacket] = useState<WeatherPacket | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const result = useMemo(() => {
    if (!packet) return null
    const days = packet.days.map((d) => d.day)
    const wx = new Map<string, WxDay>(packet.days.map((d) => [d.day, d]))
    const hours = new Map(packet.days.map((d) => [d.day, d.hours]))
    const j = judgeDays(days, wx, hours, th)
    const s = claimDays(j.verdicts, anticipated)
    return { ...j, summary: s }
  }, [packet, th, anticipated])

  async function run() {
    setBusy('run'); setErr(null)
    const r = await weatherPacketAction({ siteId, from, to }).catch(() => null)
    setBusy(null)
    if (!r?.ok) { setErr((r && 'error' in r && r.error) || 'Couldn’t read the weather — try again.'); return }
    setPacket(r.packet)
  }

  const letter = packet && result ? claimLetter({ companyName: packet.companyName, jobName: packet.site.name, jobNumber: packet.job.number, customer: packet.job.customer, contractNo: packet.job.contractNo, from: packet.from, to: packet.to, summary: result.summary, verdicts: result.verdicts, normalHours: result.normalHours, today: new Date().toLocaleDateString('en-CA'), lat: packet.site.lat, lng: packet.site.lng }) : ''

  async function pdf() {
    if (!packet || !result) return
    setBusy('pdf'); setErr(null)
    try {
      const { jsPDF } = await import('jspdf')
      const autoTable = (await import('jspdf-autotable')).default
      const doc = new jsPDF({ unit: 'pt', format: 'letter' })
      const M = 54
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10.5)
      const lines = doc.splitTextToSize(letter, doc.internal.pageSize.getWidth() - 2 * M) as string[]
      let y = M
      for (const l of lines) { if (y > doc.internal.pageSize.getHeight() - M) { doc.addPage(); y = M } doc.text(l, M, y); y += 14 }
      doc.addPage()
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(`Day-by-day record · ${packet.site.name}`, M, M)
      autoTable(doc, {
        startY: M + 12, margin: { left: M, right: M },
        head: [['Date', 'Rain (in)', 'Gust (mph)', 'Low / high °F', 'Hours on site', 'Weather', 'Claimed']],
        body: result.verdicts.map((v) => [`${v.weekday} ${v.day}`, v.wx?.precipIn?.toFixed(2) ?? '—', v.wx?.gustMph != null ? String(Math.round(v.wx.gustMph)) : '—',
          v.wx?.tMinF != null && v.wx?.tMaxF != null ? `${Math.round(v.wx.tMinF)} / ${Math.round(v.wx.tMaxF)}` : '—', String(v.hours), v.reasons.join('; '), v.lost ? 'YES' : v.workedThrough ? 'worked through' : '']),
        styles: { fontSize: 8, cellPadding: 3 }, headStyles: { fillColor: [235, 235, 235], textColor: 20 }, theme: 'grid',
      })
      doc.setFontSize(8)
      doc.text('Weather: Open-Meteo historical archive at the site’s centre. Hours: GPS records of the company’s equipment on the site and its crew’s time clock.', M, doc.internal.pageSize.getHeight() - 30, { maxWidth: doc.internal.pageSize.getWidth() - 2 * M })
      const e = await deliverDoc(doc.output('blob'), `weather-delay-${fileSlug(packet.site.name)}-${packet.from}-${packet.to}.pdf`, 'pdf', `Weather delay · ${packet.site.name}`)
      if (e) setErr(e)
    } catch { setErr('Couldn’t build the PDF — try again.') }
    setBusy(null)
  }
  async function sheet() {
    if (!packet || !result) return
    setBusy('xlsx'); setErr(null)
    const rows: (string | number | null)[][] = [['Date', 'Weekday', 'Rain (in)', 'Max gust (mph)', 'Low (F)', 'High (F)', 'Hours on site', 'Weather', 'Claimed']]
    for (const v of result.verdicts) rows.push([v.day, v.weekday, v.wx?.precipIn ?? null, v.wx?.gustMph ?? null, v.wx?.tMinF ?? null, v.wx?.tMaxF ?? null, v.hours, v.reasons.join('; '), v.lost ? 'yes' : v.workedThrough ? 'worked through' : ''])
    const e = await deliverDoc(await xlsxBlob([{ name: 'Weather days', rows }]), `weather-days-${fileSlug(packet.site.name)}-${packet.from}-${packet.to}.xlsx`, 'xlsx', `Weather days · ${packet.site.name}`).catch(() => 'Couldn’t build the spreadsheet.')
    if (e) setErr(e)
    setBusy(null)
  }

  const months = result ? result.summary.byMonth.map((m) => m.month) : []
  return (
    <BetaPage title="Weather-delay packet" icon={<CloudRain className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="A time-extension request with the proof attached: the weather at the site each day, and the hours your machines and crew actually logged there. Only days where both say the work stopped are claimed.">
      <div className={`${card} space-y-3`}>
        <div className="grid gap-2 sm:grid-cols-3">
          <label className="min-w-0"><span className="text-faint text-[12px] block">Site</span>
            <select className={box} value={siteId} onChange={(e) => { setSite(e.target.value); setPacket(null) }}>{sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label><span className="text-faint text-[12px] block">From</span><input type="date" className={box} value={from} max={to} onChange={(e) => { setFrom(e.target.value); setPacket(null) }} /></label>
          <label><span className="text-faint text-[12px] block">To</span><input type="date" className={box} value={to} max={defaultTo} onChange={(e) => { setTo(e.target.value); setPacket(null) }} /></label>
        </div>
        <details>
          <summary className="cursor-pointer text-muted text-[12.5px]">What counts as a weather day (your contract’s definition)</summary>
          <div className="grid gap-2 sm:grid-cols-4 mt-2">
            <Num label='Rain day at (in)' v={th.rainIn} set={(n) => setTh({ ...th, rainIn: n })} />
            <Num label='Mud day after (in)' v={th.mudAfterIn} set={(n) => setTh({ ...th, mudAfterIn: n })} />
            <Num label='Too cold: high ≤ °F' v={th.freezeF} set={(n) => setTh({ ...th, freezeF: n })} />
            <Num label='Too windy: gusts ≥ mph' v={th.windMph} set={(n) => setTh({ ...th, windMph: n })} />
          </div>
          <label className="flex items-center gap-2 mt-2 text-muted"><input type="checkbox" className="h-4 w-4 accent-amber" checked={th.saturdays} onChange={(e) => setTh({ ...th, saturdays: e.target.checked })} /> Saturdays are working days</label>
        </details>
        {err && <Notice tone="bad">{err}</Notice>}
        <button type="button" className={primary} disabled={!canRun || !siteId || busy === 'run'} onClick={run}>{busy === 'run' ? 'Reading the weather…' : 'Build the packet'}</button>
      </div>

      {packet && result && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <div className={card}><p className="text-faint text-[11px]">Days lost</p><p className="font-display font-bold text-lg text-ink">{result.summary.lost}</p></div>
            <div className={card}><p className="text-faint text-[11px]">Anticipated in contract</p><p className="font-display font-bold text-lg text-ink">{result.summary.anticipated}</p></div>
            <div className={card}><p className="text-faint text-[11px]">Days to request</p><p className="font-display font-bold text-lg text-amber">{result.summary.claim}</p></div>
          </div>
          {result.normalHours === 0 && <Notice tone="warn">No worked days on record at this site in the window — a day only counts when the hours show the work stopped, so nothing can be claimed yet.</Notice>}
          {months.length > 0 && (
            <div className={`${card} space-y-1.5`}>
              <p className="font-semibold text-ink">Anticipated weather days in the contract</p>
              <div className="flex flex-wrap gap-2">
                {months.map((m) => <Num key={m} label={new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })} v={anticipated[m] ?? 0} set={(n) => setAnt({ ...anticipated, [m]: n })} />)}
              </div>
            </div>
          )}
          <div className="overflow-x-auto rounded-xl border border-navy-800">
            <table className="w-full text-[12px] min-w-[560px]">
              <thead className="bg-navy-900 text-faint"><tr><th className="text-left px-2 py-1.5">Day</th><th className="px-2">Rain</th><th className="px-2">Gust</th><th className="px-2">Lo/Hi</th><th className="px-2">Hours</th><th className="text-left px-2">Verdict</th></tr></thead>
              <tbody>
                {result.verdicts.map((v) => (
                  <tr key={v.day} className="border-t border-navy-800">
                    <td className="px-2 py-1 text-ink">{v.weekday} {fmtDay(v.day)}</td>
                    <td className="px-2 text-center">{v.wx?.precipIn != null ? `${v.wx.precipIn.toFixed(2)}"` : '—'}</td>
                    <td className="px-2 text-center">{v.wx?.gustMph != null ? Math.round(v.wx.gustMph) : '—'}</td>
                    <td className="px-2 text-center">{v.wx?.tMinF != null ? `${Math.round(v.wx.tMinF)}/${Math.round(v.wx.tMaxF ?? 0)}` : '—'}</td>
                    <td className="px-2 text-center">{v.hours}</td>
                    <td className="px-2">{v.lost ? <StatePill state="bad">Lost — {v.reasons.join(', ')}</StatePill> : v.workedThrough ? <StatePill state="ok">Worked through {v.reasons.join(', ')}</StatePill> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <details className={card} open>
            <summary className="cursor-pointer font-semibold text-ink">The letter</summary>
            <pre className="whitespace-pre-wrap text-[12.5px] text-muted mt-2 font-sans">{letter}</pre>
          </details>
          <div className="flex flex-wrap gap-2">
            <button type="button" className={btn} disabled={!!busy} onClick={pdf}><FileDown className="h-4 w-4" /> {busy === 'pdf' ? 'Building…' : 'Letter + record (PDF)'}</button>
            <button type="button" className={btn} disabled={!!busy} onClick={sheet}><FileSpreadsheet className="h-4 w-4" /> {busy === 'xlsx' ? 'Building…' : 'Day-by-day spreadsheet'}</button>
          </div>
        </>
      )}
    </BetaPage>
  )
}

function Num({ label, v, set }: { label: string; v: number; set: (n: number) => void }) {
  return (
    <label className="min-w-0"><span className="text-faint text-[12px] block">{label}</span>
      <input inputMode="decimal" className={box} defaultValue={String(v)} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n >= 0) set(n) }} /></label>
  )
}
