/**
 * Spanish for the field (Beta, Nov 19). The crew's screens — the bottom bar,
 * the More drawer, the time clock, the inspection and card screens — read in
 * Spanish when the phone is set to it. Per DEVICE (a crew phone is one
 * person's), stored in localStorage `ht_lang`; Beta → Español switches it.
 *
 * Keyed by the English string, so a screen wraps what it already says in
 * t(...) and an untranslated string simply stays English — never blank.
 * Office pages (money, plans, jobs) stay English for now: the people reading
 * them read the contracts they mirror.
 */
'use client'

import { useEffect, useState } from 'react'

export type Lang = 'en' | 'es'
const KEY = 'ht_lang'
const EVENT = 'ht:lang'

const ES: Record<string, string> = {
  // bottom bar + drawer
  'Map': 'Mapa', 'Assets': 'Máquinas', 'Alerts': 'Alertas', 'Time clock': 'Reloj de entrada', 'Clock in': 'Entrada', 'Time cards': 'Tarjetas de tiempo', 'Cards': 'Tarjetas',
  'Zones': 'Zonas', 'Plans': 'Planos', 'Jobs': 'Obras', 'Measurements': 'Medidas', 'Measure': 'Medir', 'Tag scanner': 'Etiquetas', 'Tags': 'Etiquetas',
  'Command Center': 'Centro de mando', 'Command': 'Centro', 'Share location': 'Compartir ubicación', 'Live': 'En vivo', 'Daily logs': 'Reportes diarios', 'Logs': 'Reportes',
  'Photos': 'Fotos', 'Safety': 'Seguridad', 'Team': 'Equipo', 'Team activity': 'Actividad', 'Activity': 'Actividad', 'Maintenance': 'Mantenimiento', 'Service': 'Servicio',
  'Reports': 'Informes', 'Accounting': 'Contabilidad', 'Books': 'Cuentas', 'Receipts': 'Recibos', 'Financials': 'Finanzas', 'Finance': 'Finanzas', 'Trackers': 'Rastreadores',
  'Hardware setup': 'Instalación', 'Hardware': 'Instalación', 'Settings': 'Ajustes', 'Getting started': 'Primeros pasos', 'Start': 'Inicio', 'Help': 'Ayuda',
  'Flight log': 'Vuelos', 'Flights': 'Vuelos', 'Beta': 'Beta', 'More': 'Más', 'Edit': 'Editar', 'Done': 'Listo',
  'Watch': 'Vigilar', 'Field': 'Campo', 'Office': 'Oficina', 'Setup': 'Configuración', 'Advanced': 'Avanzado', 'Other': 'Otro', 'My phone': 'Mi teléfono', 'Sign out': 'Cerrar sesión',
  // time clock
  'Morning': 'Buenos días', 'Afternoon': 'Buenas tardes', 'Evening': 'Buenas noches', 'Hey': 'Hola',
  'Project': 'Obra', 'Shop': 'Taller', 'Office / other': 'Oficina / otro',
  'Clock in with a photo': 'Marcar entrada con foto', 'Clocking in…': 'Marcando entrada…', 'Waiting for location…': 'Esperando ubicación…',
  'Log it & clock out': 'Guardar y marcar salida', 'Saving…': 'Guardando…', 'Retake': 'Repetir', 'Take your photo': 'Tómate la foto',
  'Yes': 'Sí', 'No': 'No', 'Pick one…': 'Escoge uno…',
  'Location is off — your shift is not being recorded. Turn it on to keep your time card GPS-verified.': 'La ubicación está apagada — tu turno no se está grabando. Préndela para que tu tarjeta quede verificada por GPS.',
  'Shift tracking starts as soon as the app has your location.': 'El registro del turno empieza en cuanto la app tenga tu ubicación.',
  'Location is required to clock in. Allow location for HammerTrack (Settings → Location), then tap Clock in again.': 'Se necesita la ubicación para marcar entrada. Permite la ubicación para HammerTrack (Ajustes → Ubicación) y vuelve a tocar Entrada.',
  'No signal — and this phone is blocking offline storage. Try again in coverage.': 'Sin señal — y este teléfono bloquea el guardado sin conexión. Inténtalo donde haya cobertura.',
  'Clock-in failed': 'No se pudo marcar entrada', 'Clock-out failed': 'No se pudo marcar salida',
  'Filing your daily log…': 'Enviando tu reporte diario…',
  'That photo couldn’t be read — try taking it again.': 'No se pudo leer la foto — tómala otra vez.',
  "Plan for today (one line — what's getting done?)": 'Plan de hoy (una línea — ¿qué se va a hacer?)',
  'Saved on your phone': 'Guardado en tu teléfono', 'On the clock': 'En turno', 'Take photo': 'Tomar foto', 'From gallery': 'De la galería', 'Back': 'Atrás',
  'Your company asks for a quick photo of you at clock-in, and clocking in only works at the site or the yard.': 'Tu compañía pide una foto rápida al marcar entrada, y solo se puede marcar en la obra o en el patio.',
  'Your company asks for a quick photo of you at clock-in — the front camera opens when you tap.': 'Tu compañía pide una foto rápida al marcar entrada — la cámara frontal se abre al tocar.',
  'Your company has clock-in set to work only at the site or the yard.': 'Tu compañía solo permite marcar entrada en la obra o en el patio.',
  "Clock in to where the day's going. The daily log is the way out.": 'Marca entrada donde va el día. El reporte diario es la salida.',
  'Ask AI': 'Pregúntale a la IA', 'Truck inspection': 'Inspección del camión', 'Inspect': 'Inspección',
  // safety
  'Toolbox talks': 'Charlas de seguridad', 'Sign it': 'Firmar', 'Report something': 'Reportar algo',
  'Toolbox talks the crew signs on the phone, and reports from the field. Same login as the time clock — no tablet, no paper.': 'Charlas de seguridad que la cuadrilla firma en el teléfono, y reportes del campo. El mismo acceso del reloj — sin tableta, sin papel.',
  'Truck inspections (DVIR)': 'Inspecciones del camión (DVIR)',
  'Pre- and post-trip inspections, signed on the phone. Every defect opens a work order; out-of-service ones say DO NOT OPERATE until someone signs off the repair.': 'Inspecciones antes y después del viaje, firmadas en el teléfono. Cada defecto abre una orden de trabajo; los que lo sacan de servicio dicen NO OPERAR hasta que alguien firme la reparación.',
  'Certify repaired': 'Certificar reparado', 'Repair not needed': 'No necesita reparación', "I’m the next driver — I saw the sign-off": 'Soy el siguiente chofer — vi la firma',
  'Your cards and certifications. Add each one with its expiry — you’ll see it here before it runs out.': 'Tus tarjetas y certificaciones. Agrega cada una con su vencimiento — la verás aquí antes de que venza.',
  'Nothing yet.': 'Nada todavía.',
  // inspections (DVIR)
  'Pre-trip': 'Antes del viaje', 'Post-trip': 'Después del viaje', 'Vehicle': 'Vehículo', 'Odometer': 'Odómetro', 'Trailer (if hooked up)': 'Remolque (si va enganchado)',
  'Tap anything that is wrong': 'Toca lo que esté mal', 'Minor': 'Menor', 'Out of service': 'Fuera de servicio', 'What is wrong?': '¿Qué está mal?',
  'Sign here': 'Firma aquí', 'Clear': 'Borrar', 'File inspection': 'Enviar inspección', 'Filing…': 'Enviando…',
  'No defects — safe to operate': 'Sin defectos — se puede operar',
  'Service brakes (incl. trailer brake connections)': 'Frenos de servicio (y conexiones del remolque)', 'Parking brake': 'Freno de estacionamiento',
  'Steering mechanism': 'Dirección', 'Lights and reflectors': 'Luces y reflectores', 'Tires': 'Llantas', 'Horn': 'Claxon', 'Windshield wipers': 'Limpiaparabrisas',
  'Rear-vision mirrors': 'Espejos', 'Coupling devices / fifth wheel': 'Enganche / quinta rueda', 'Wheels and rims': 'Ruedas y rines',
  'Emergency equipment (extinguisher, triangles)': 'Equipo de emergencia (extintor, triángulos)', 'Fluid leaks (oil, coolant, fuel, air)': 'Fugas (aceite, anticongelante, diésel, aire)',
  'Body, doors, load securement': 'Carrocería, puertas, amarre de carga', 'Trailer brakes': 'Frenos del remolque', 'Trailer lights': 'Luces del remolque',
  'Trailer tires and wheels': 'Llantas y ruedas del remolque', 'Hitch, pin, chains': 'Enganche, perno, cadenas',
  // cards & certs
  'My cards': 'Mis tarjetas', 'Expires': 'Vence', 'Expired': 'Vencida', 'Does not expire': 'No vence', 'Add a card': 'Agregar tarjeta',
}

export function tr(s: string, lang: Lang): string {
  return lang === 'es' ? ES[s] ?? s : s
}

export function readLang(): Lang {
  try { return localStorage.getItem(KEY) === 'es' ? 'es' : 'en' } catch { return 'en' }
}

export function setLang(lang: Lang) {
  try { localStorage.setItem(KEY, lang) } catch { /* private window: this visit only */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: lang }))
}

/** The device's language, live — and `t`, the translator for it. */
export function useLang(): { lang: Lang; t: (s: string) => string } {
  const [lang, set] = useState<Lang>('en')
  useEffect(() => {
    set(readLang())
    const on = (e: Event) => set((e as CustomEvent).detail === 'es' ? 'es' : 'en')
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) set(readLang()) }
    window.addEventListener(EVENT, on)
    window.addEventListener('storage', onStorage)
    return () => { window.removeEventListener(EVENT, on); window.removeEventListener('storage', onStorage) }
  }, [])
  return { lang, t: (s: string) => tr(s, lang) }
}

/** How many of a set of strings have Spanish — the Beta page says it honestly. */
export const ES_COUNT = Object.keys(ES).length
