// Numbers, dates and durations in the UI language. Units go through the dictionary, so English
// gets compact forms ("5m ago", "2m 43s", "205.3K") and Indonesian keeps "5 mnt lalu", "2 mnt 43 dtk", "205,3 rb".
import { intlLocale, type Locale } from '@shared/i18n'
import { currentLocale, t } from '@/lib/i18n'

interface Formats {
  nf: Intl.NumberFormat
  nf1: Intl.NumberFormat
  nf2: Intl.NumberFormat
  dateShort: Intl.DateTimeFormat
  dateLong: Intl.DateTimeFormat
  timeFmt: Intl.DateTimeFormat
  timeSecFmt: Intl.DateTimeFormat
}

const cache = new Map<Locale, Formats>()

function formats(): Formats {
  const locale = currentLocale()
  let f = cache.get(locale)
  if (!f) {
    const tag = intlLocale(locale)
    // Indonesian keeps two-digit hours ("09.41"); English reads "9:41 PM"
    const hour = locale === 'id' ? '2-digit' : 'numeric'
    f = {
      nf: new Intl.NumberFormat(tag),
      nf1: new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }),
      nf2: new Intl.NumberFormat(tag, { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      dateShort: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'short' }),
      dateLong: new Intl.DateTimeFormat(tag, { day: 'numeric', month: 'long', year: 'numeric' }),
      timeFmt: new Intl.DateTimeFormat(tag, { hour, minute: '2-digit' }),
      timeSecFmt: new Intl.DateTimeFormat(tag, { hour, minute: '2-digit', second: '2-digit' })
    }
    cache.set(locale, f)
  }
  return f
}

export function num(n: number): string {
  return formats().nf.format(n)
}

export function compact(n: number): string {
  const a = Math.abs(n)
  const { nf, nf1 } = formats()
  if (a >= 1e9) return t('{n}B', { n: nf1.format(n / 1e9) })
  if (a >= 1e6) return t('{n}M', { n: nf1.format(n / 1e6) })
  if (a >= 1e4) return t('{n}K', { n: nf1.format(n / 1e3) })
  return nf.format(n)
}

export function tokens(n: number): string {
  return compact(n)
}

export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return `$${formats().nf2.format(n)}`
}

export function bytes(n: number): string {
  const { nf1 } = formats()
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${nf1.format(n / 1024)} KB`
  if (n < 1024 * 1024 * 1024) return `${nf1.format(n / 1024 / 1024)} MB`
  return `${nf1.format(n / 1024 / 1024 / 1024)} GB`
}

export function duration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const s = Math.round(ms / 1000)
  if (s < 60) return t('{s}s', { s })
  const m = Math.floor(s / 60)
  if (m < 60) return s % 60 ? t('{m}m {s}s', { m, s: s % 60 }) : t('{m}m', { m })
  const h = Math.floor(m / 60)
  if (h < 24) return m % 60 ? t('{h}h {m}m', { h, m: m % 60 }) : t('{h}h', { h })
  const d = Math.floor(h / 24)
  return h % 24 ? t('{d}d {h}h', { d, h: h % 24 }) : t('{d}d', { d })
}

export function clock(ts: number, seconds = false): string {
  const f = formats()
  return (seconds ? f.timeSecFmt : f.timeFmt).format(ts)
}

export function date(ts: number): string {
  return formats().dateLong.format(ts)
}

export function ago(ts: number, now = Date.now()): string {
  const diff = Math.max(0, now - ts)
  const s = Math.floor(diff / 1000)
  if (s < 45) return t('just now')
  const m = Math.floor(s / 60)
  if (m < 60) return t('{n}m ago', { n: Math.max(1, m) })
  const h = Math.floor(m / 60)
  if (h < 24) return t('{n}h ago', { n: h })
  const d = Math.floor(h / 24)
  if (d === 1) return t('yesterday')
  if (d < 7) return t('{n}d ago', { n: d })
  return formats().dateShort.format(ts)
}

export function plural(n: number, word: string): string {
  return `${num(n)} ${word}`
}
