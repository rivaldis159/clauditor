// UI translations. English is the source language: code calls t('English text') and other
// locales map that exact text to their own. Missing entries fall back to English, so an
// untranslated string is never blank.
import { id } from './id'

export type Locale = 'en' | 'id'
export type Vars = Record<string, string | number>

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'English' },
  { value: 'id', label: 'Bahasa Indonesia' }
]

const DICTIONARIES: Record<Locale, Record<string, string> | null> = { en: null, id }

/** BCP 47 tag for Intl formatting (dates, numbers, relative time). */
export function intlLocale(locale: Locale): string {
  return locale === 'id' ? 'id-ID' : 'en-US'
}

export function isLocale(v: unknown): v is Locale {
  return v === 'en' || v === 'id'
}

const missing = new Set<string>()
let reportMissing: ((locale: Locale, text: string) => void) | null = null

/** Development aid: called once per text that has no translation in a non-English locale. */
export function onMissingTranslation(fn: ((locale: Locale, text: string) => void) | null): void {
  reportMissing = fn
}

function interpolate(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

/**
 * Keys may carry a context, "context::Text", when the same English word needs different
 * translations (e.g. "done::Read" for a finished tool card vs "Read" as a chart label).
 * English shows only the text after "::".
 */
export function sourceText(key: string): string {
  const i = key.indexOf('::')
  return i > 0 ? key.slice(i + 2) : key
}

export function translate(locale: Locale, text: string, vars?: Vars): string {
  const dict = DICTIONARIES[locale]
  let s = sourceText(text)
  if (dict) {
    const hit = dict[text]
    if (hit !== undefined) s = hit
    else if (reportMissing && !missing.has(`${locale}\u0000${text}`)) {
      missing.add(`${locale}\u0000${text}`)
      reportMissing(locale, text)
    }
  }
  return interpolate(s, vars)
}

/**
 * Count-dependent text. English picks `one` for 1 and `other` otherwise; Indonesian has no
 * plural forms, so its dictionary only needs the `other` text.
 */
export function translatePlural(locale: Locale, count: number, one: string, other: string, vars?: Vars): string {
  const v = { n: count, ...vars }
  if (locale === 'en') return interpolate(count === 1 ? one : other, v)
  return translate(locale, other, v)
}
