import type { TextEncodingName } from '@shared/types'

const utf8Strict = new TextDecoder('utf-8', { fatal: true })
const cp1252 = new TextDecoder('windows-1252')

export interface Decoded {
  text: string
  encoding: TextEncodingName
  eol: 'LF' | 'CRLF'
  binary: boolean
}

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8192)
  let suspicious = 0
  for (let i = 0; i < n; i++) {
    const b = buf[i]
    if (b === 0) return true
    if (b < 7 || (b > 13 && b < 32 && b !== 27)) suspicious++
  }
  return n > 0 && suspicious / n > 0.1
}

export function detectEol(text: string): 'LF' | 'CRLF' {
  const crlf = text.indexOf('\r\n')
  if (crlf === -1) return 'LF'
  const lf = text.indexOf('\n')
  return lf === crlf + 1 ? 'CRLF' : 'LF'
}

export function decodeBuffer(buf: Buffer): Decoded {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    const text = buf.subarray(3).toString('utf8')
    return { text, encoding: 'utf8bom', eol: detectEol(text), binary: false }
  }
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    const text = buf.subarray(2).toString('utf16le')
    return { text, encoding: 'utf16le', eol: detectEol(text), binary: false }
  }
  if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
    const swapped = Buffer.from(buf.subarray(2))
    swapped.swap16()
    const text = swapped.toString('utf16le')
    return { text, encoding: 'utf16be', eol: detectEol(text), binary: false }
  }
  if (looksBinary(buf)) return { text: '', encoding: 'utf8', eol: 'LF', binary: true }
  try {
    const text = utf8Strict.decode(buf)
    return { text, encoding: 'utf8', eol: detectEol(text), binary: false }
  } catch {
    const text = cp1252.decode(buf)
    return { text, encoding: 'windows1252', eol: detectEol(text), binary: false }
  }
}

// windows-1252 code points 0x80–0x9F that differ from Latin-1
const CP1252_EXTRA: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87,
  0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91,
  0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98,
  0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f
}

function encodeCp1252(text: string): Buffer {
  const out = Buffer.alloc(text.length)
  let j = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 63
    if (cp < 0x80 || (cp >= 0xa0 && cp <= 0xff)) out[j++] = cp
    else out[j++] = CP1252_EXTRA[cp] ?? 0x3f
  }
  return out.subarray(0, j)
}

export function encodeText(text: string, encoding: TextEncodingName): Buffer {
  switch (encoding) {
    case 'utf8bom':
      return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(text, 'utf8')])
    case 'utf16le':
      return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(text, 'utf16le')])
    case 'utf16be': {
      const body = Buffer.from(text, 'utf16le')
      body.swap16()
      return Buffer.concat([Buffer.from([0xfe, 0xff]), body])
    }
    case 'windows1252':
      return encodeCp1252(text)
    default:
      return Buffer.from(text, 'utf8')
  }
}
