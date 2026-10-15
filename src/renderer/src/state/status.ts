import { create } from 'zustand'

export interface EditorStatus {
  line: number
  column: number
  selected: number
  language: string
  eol: 'LF' | 'CRLF'
  encoding: string
  tabSize: number
  insertSpaces: boolean
  path: string | null
}

export const useEditorStatus = create<EditorStatus & { set(p: Partial<EditorStatus>): void }>((set) => ({
  line: 1,
  column: 1,
  selected: 0,
  language: '',
  eol: 'LF',
  encoding: 'UTF-8',
  tabSize: 2,
  insertSpaces: true,
  path: null,
  set(p) {
    set(p)
  }
}))
