// Network test (opt-in): NET_TESTS=1 npx vitest run sdk-sync
// Fetches a real Agent SDK release from the npm registry the way Clauditor does after a Claude update.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({ net: { fetch: (...args: Parameters<typeof fetch>) => fetch(...args) } }))

describe.skipIf(!process.env.NET_TESTS)('SdkManager.sync (npm registry)', () => {
  it('downloads, verifies and loads the SDK made for a newer Claude Code', async () => {
    const { SdkManager } = await import('../../src/main/services/claude/sdk')
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-sync-'))
    const sdk = new SdkManager(dir)
    const bundled = sdk.info()
    // pretend Claude desktop shipped a Claude Code newer than the bundled SDK targets
    const [maj, min, patch] = (bundled.claudeCodeVersion ?? '2.1.0').split('.').map(Number)
    const cli = `${maj}.${min}.${patch + 50}`
    const installed = await sdk.sync(cli)
    const entries = fs.existsSync(path.join(dir, 'claude-sdk')) ? fs.readdirSync(path.join(dir, 'claude-sdk')) : []
    console.log({ bundled, cli, installed, entries })
    if (installed) {
      expect(sdk.select(cli)).toBe(true)
      const info = sdk.info()
      expect(info.source).toBe('synced')
      const mod = await import(pathToFileURL(path.join(dir, 'claude-sdk', info.version ?? '', 'sdk.mjs')).href)
      expect(typeof mod.query).toBe('function')
    } else {
      // no newer release published yet: nothing to do, and the bundled SDK stays
      expect(sdk.info().source).toBe('bundled')
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }, 120_000)
})
