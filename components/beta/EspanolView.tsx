'use client'

/** Switch this phone's crew screens to Spanish (lib/i18n.ts) — per phone, stored on the device. */
import { Languages } from 'lucide-react'
import { setLang, useLang, ES_COUNT } from '@/lib/i18n'
import { BetaPage, Notice, card } from './ui'

const WHERE = [
  ['The bottom bar and the More drawer', 'La barra de abajo y el cajón “Más”'],
  ['The time clock — clock in, clock out, the daily log', 'El reloj — entrada, salida, el reporte diario'],
  ['Truck inspections (DVIR)', 'Inspecciones del camión (DVIR)'],
  ['My cards', 'Mis tarjetas'],
  ['Safety — the page and its buttons (the talks themselves are still English)', 'Seguridad — la página y sus botones (las charlas todavía están en inglés)'],
]

export function EspanolView({ demo }: { demo: boolean }) {
  const { lang } = useLang()
  return (
    <BetaPage title="Español" icon={<Languages className="h-5 w-5 text-violet-300" />} demo={demo}
      blurb="The crew’s screens in Spanish. It’s set per phone — hand a crew member their phone, flip it here, and it stays that way on that phone.">
      <div className={`${card} space-y-3`}>
        <p className="text-ink font-semibold">This phone / Este teléfono</p>
        <div className="grid grid-cols-2 gap-1 rounded-xl border border-navy-800 bg-navy-950 p-1">
          <button type="button" onClick={() => setLang('en')} className={'rounded-lg py-3 font-semibold ' + (lang === 'en' ? 'bg-amber text-navy-950' : 'text-muted')}>English</button>
          <button type="button" onClick={() => setLang('es')} className={'rounded-lg py-3 font-semibold ' + (lang === 'es' ? 'bg-amber text-navy-950' : 'text-muted')}>Español</button>
        </div>
        <p className="text-muted">{lang === 'es' ? 'Listo — estas pantallas ya están en español:' : 'In Spanish when switched:'}</p>
        <ul className="list-disc pl-5 text-muted space-y-0.5">{WHERE.map(([en, es]) => <li key={en}>{lang === 'es' ? es : en}</li>)}</ul>
      </div>
      <Notice tone="info">Beta: {ES_COUNT} phrases so far, field screens first. Office pages (jobs, plans, money) stay in English for now. A phrase that isn’t translated yet shows in English — never blank.</Notice>
    </BetaPage>
  )
}
