// Renderer side of the translations: `useT()` in components (re-renders on a language change),
// `t()` / `tn()` everywhere else (reads the language at call time).
import { Fragment, createElement, useMemo, type ReactNode } from 'react'
import { intlLocale, translate, translatePlural, type Locale, type Vars } from '@shared/i18n'
import { useApp } from '@/state/app'

export type { Locale, Vars }

export function currentLocale(): Locale {
  return useApp.getState().settings.language
}

/** Translate English source text into the current UI language. */
export function t(text: string, vars?: Vars): string {
  return translate(currentLocale(), text, vars)
}

/**
 * Marks English text that is stored now and translated later with t(), e.g. labels in
 * module-level constants. Returns the text unchanged; the i18n check script collects it.
 */
export const tk = (text: string): string => text

/** Count-dependent text: tn(3, '{n} file', '{n} files'). `{n}` is filled in automatically. */
export function tn(count: number, one: string, other: string, vars?: Vars): string {
  return translatePlural(currentLocale(), count, one, other, vars)
}

export interface T {
  (text: string, vars?: Vars): string
  /** plural: t.n(count, one, other, vars?) */
  n(count: number, one: string, other: string, vars?: Vars): string
  /**
   * Text with elements inside: t.rich('Set {exe} in Settings', { exe: <code>claude.exe</code> }).
   * Placeholders may sit anywhere, so each language keeps its own word order.
   */
  rich(text: string, parts: Record<string, ReactNode>): ReactNode
  locale: Locale
  /** BCP 47 tag for Intl APIs */
  intl: string
}

function richText(translated: string, parts: Record<string, ReactNode>): ReactNode {
  const pieces = translated.split(/\{(\w+)\}/)
  return createElement(
    Fragment,
    null,
    ...pieces.map((p, i) => (i % 2 === 1 ? createElement(Fragment, { key: i }, p in parts ? parts[p] : `{${p}}`) : p))
  )
}

/** Translator bound to the current language; components re-render when it changes. */
export function useT(): T {
  const locale = useApp((s) => s.settings.language)
  return useMemo(() => {
    const fn = ((text: string, vars?: Vars) => translate(locale, text, vars)) as T
    fn.n = (count, one, other, vars) => translatePlural(locale, count, one, other, vars)
    fn.rich = (text, parts) => richText(translate(locale, text), parts)
    fn.locale = locale
    fn.intl = intlLocale(locale)
    return fn
  }, [locale])
}
