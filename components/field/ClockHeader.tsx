'use client'

import { useLang } from '@/lib/i18n'

/** The time clock's title, in the phone's language. */
export function ClockHeader() {
  const { t } = useLang()
  return (
    <div>
      <h1 className="font-display font-bold text-xl text-ink">{t('Time clock')}</h1>
      <p className="text-[12.5px] text-faint">{t("Clock in to where the day's going. The daily log is the way out.")}</p>
    </div>
  )
}
