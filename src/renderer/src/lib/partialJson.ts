// Extract top-level string fields from an incomplete JSON object, as streamed by
// `input_json_delta` events. An unterminated trailing string is returned as-is (decoded),
// which lets the UI show code while Claude is still "typing" it.

export interface PartialFields {
  values: Record<string, string>
  /** key whose string value is still open at the end of the input */
  open: string | null
}

const ESC: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }

export function partialFields(src: string): PartialFields {
  const values: Record<string, string> = {}
  let open: string | null = null
  let i = src.indexOf('{')
  if (i === -1) return { values, open }
  i++
  const n = src.length

  const skipWs = () => {
    while (i < n && /\s/.test(src[i])) i++
  }

  const readString = (): { text: string; closed: boolean } => {
    // assumes src[i] === '"'
    i++
    let out = ''
    while (i < n) {
      const c = src[i]
      if (c === '"') {
        i++
        return { text: out, closed: true }
      }
      if (c === '\\') {
        if (i + 1 >= n) {
          i = n
          break
        }
        const e = src[i + 1]
        if (e === 'u') {
          const hex = src.slice(i + 2, i + 6)
          if (hex.length < 4) {
            i = n
            break
          }
          out += String.fromCharCode(Number.parseInt(hex, 16))
          i += 6
          continue
        }
        out += ESC[e] ?? e
        i += 2
        continue
      }
      out += c
      i++
    }
    return { text: out, closed: false }
  }

  const skipValue = (): boolean => {
    // skip non-string value (number, bool, null, object, array); returns false if input ended
    let depth = 0
    while (i < n) {
      const c = src[i]
      if (c === '"') {
        const s = readString()
        if (!s.closed) return false
        continue
      }
      if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') {
        if (depth === 0) return true
        depth--
      } else if (c === ',' && depth === 0) return true
      i++
    }
    return false
  }

  while (i < n) {
    skipWs()
    if (src[i] === ',') {
      i++
      continue
    }
    if (src[i] === '}') break
    if (src[i] !== '"') break
    const k = readString()
    if (!k.closed) break
    skipWs()
    if (src[i] !== ':') break
    i++
    skipWs()
    if (i >= n) break
    if (src[i] === '"') {
      const v = readString()
      values[k.text] = v.text
      if (!v.closed) {
        open = k.text
        break
      }
    } else if (!skipValue()) break
  }
  return { values, open }
}
