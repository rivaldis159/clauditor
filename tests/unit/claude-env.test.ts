import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { compareVersions, pickCandidate, untar } from '../../src/main/services/claude/sdk'
import { findFonts, fontUrl, toModelOption } from '../../src/main/services/claude/environment'

describe('compareVersions', () => {
  it('orders dotted versions numerically', () => {
    expect(compareVersions('2.1.295', '2.1.300')).toBeLessThan(0)
    expect(compareVersions('2.10.0', '2.9.9')).toBeGreaterThan(0)
    expect(compareVersions('2.1.299', '2.1.299')).toBe(0)
    expect(compareVersions('2.1', '2.1.0')).toBe(0)
  })
})

describe('pickCandidate', () => {
  const sdks = [
    { name: 'bundled', claudeCodeVersion: '2.1.299' },
    { name: 'synced-305', claudeCodeVersion: '2.1.305' },
    { name: 'synced-310', claudeCodeVersion: '2.1.310' }
  ]
  it('prefers the SDK made for exactly this Claude Code', () => {
    expect(pickCandidate(sdks, '2.1.305')?.name).toBe('synced-305')
  })
  it('otherwise takes the newest SDK made for an older Claude Code', () => {
    expect(pickCandidate(sdks, '2.1.308')?.name).toBe('synced-305')
    expect(pickCandidate(sdks, '2.2.0')?.name).toBe('synced-310')
  })
  it('falls back to the closest newer SDK when Claude Code is older than all of them', () => {
    expect(pickCandidate(sdks, '2.1.295')?.name).toBe('bundled')
  })
  it('uses the first candidate when the Claude Code version is unknown', () => {
    expect(pickCandidate(sdks, null)?.name).toBe('bundled')
  })
})

function tarEntry(name: string, body: string): Buffer {
  const header = Buffer.alloc(512)
  header.write(name, 0, 'utf8')
  header.write('0000644\0', 100)
  header.write(`${Buffer.byteLength(body).toString(8).padStart(11, '0')}\0`, 124)
  header.write('0', 156)
  header.write('ustar\0', 257)
  const data = Buffer.from(body)
  const pad = Buffer.alloc((512 - (data.length % 512)) % 512)
  return Buffer.concat([header, data, pad])
}

describe('untar', () => {
  it('extracts the wanted files from an npm-style tarball', () => {
    const tar = Buffer.concat([tarEntry('package/package.json', '{"version":"0.3.310"}'), tarEntry('package/sdk.mjs', 'export const query = 1'), tarEntry('package/README.md', 'x'), Buffer.alloc(1024)])
    const files = untar(zlib.gzipSync(tar), (n) => n.endsWith('.mjs') || n.endsWith('package.json'))
    expect([...files.keys()].sort()).toEqual(['package/package.json', 'package/sdk.mjs'])
    expect(files.get('package/sdk.mjs')?.toString()).toBe('export const query = 1')
  })
})

describe('findFonts', () => {
  it("finds Claude's fonts whatever their content hash", () => {
    const res = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-res-'))
    const runtime = path.join(res, 'ion-dist', '_frame-rt', '_runtime')
    fs.mkdirSync(runtime, { recursive: true })
    for (const f of ['AnthropicSans-Roman-Variable-26-179-2.542f.woff2', 'AnthropicSans-Roman-Web.1b75.woff2', 'AnthropicSans-Italic-Web.ffcf.woff2', 'AnthropicSerif-Roman-Web.e96f.woff2', 'AnthropicMono-Roman-Web.49b8.woff2', 'anthropicons-variable.82b9.woff2']) {
      fs.writeFileSync(path.join(runtime, f), '')
    }
    const fonts = findFonts(res)
    expect(fonts.sans).toBe(fontUrl(path.join(runtime, 'AnthropicSans-Roman-Variable-26-179-2.542f.woff2')))
    expect(fonts.sansItalic).toContain('AnthropicSans-Italic-Web')
    expect(fonts.serif).toContain('AnthropicSerif-Roman-Web')
    expect(fonts.mono).toContain('AnthropicMono-Roman-Web')
    expect(findFonts(null)).toEqual({ sans: null, sansItalic: null, serif: null, mono: null })
    fs.rmSync(res, { recursive: true, force: true })
  })
})

describe('toModelOption', () => {
  it("maps Claude Code's model rows, with its default row as no explicit model", () => {
    const def = toModelOption({ value: 'default', displayName: 'Default (recommended)', description: 'Use the default model', resolvedModel: 'claude-opus-5-5', supportsEffort: true, supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'], supportsAutoMode: true })
    expect(def.value).toBe('')
    expect(def.label).toBe('Default (recommended)')
    expect(def.effortLevels).toEqual(['low', 'medium', 'high', 'xhigh', 'max'])
    const plain = toModelOption({ value: 'haiku', displayName: 'Haiku' })
    expect(plain.effortLevels).toEqual([])
    expect(plain.supportsAutoMode).toBe(true)
  })
})
