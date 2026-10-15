// Main-process translations (notifications, errors shown to the user). Follows the UI language.
import { translate, translatePlural, type Locale, type Vars } from '@shared/i18n'

let locale: Locale = 'en'

export function setMainLocale(next: Locale): void {
  locale = next
}

export function t(text: string, vars?: Vars): string {
  return translate(locale, text, vars)
}

/** Marks English text stored now and translated later with t(); returns it unchanged. */
export const tk = (text: string): string => text

export function tn(count: number, one: string, other: string, vars?: Vars): string {
  return translatePlural(locale, count, one, other, vars)
}
