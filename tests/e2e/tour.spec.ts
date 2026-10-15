// Visual tour for manual pixel audits: TOUR=1 npx playwright test tour
// TOUR_LANG=id captures the Indonesian UI (selectors are English source strings mapped through the dictionary).
import fs from 'node:fs'
import { expect, test } from '@playwright/test'
import { id as ID } from '../../src/shared/i18n/id'
import { launch, type Harness } from './fixtures'
import { seedGitRepo, seedRichSession } from './seed'

test.skip(!process.env.TOUR, 'set TOUR=1 to capture the visual tour')

const lang = process.env.TOUR_LANG === 'id' ? 'id' : 'en'
const L = (text: string) => (lang === 'id' ? (ID[text] ?? text) : text)

let h: Harness
test.afterEach(async () => {
  await h?.close()
})

for (const theme of ['dark', 'light'] as const) {
  test(`tour (${theme}, ${lang})`, async () => {
    const dir = `test-results/tour/${theme}-${lang}`
    fs.mkdirSync(dir, { recursive: true })
    const shot = (name: string) => h.win.screenshot({ path: `${dir}/${name}.png` })
    h = await launch({
      status: 'idle',
      title: 'Validasi email formulir',
      settings: { theme, language: lang },
      beforeLaunch: (s) => {
        seedGitRepo(s.workspace)
        seedRichSession(s)
      }
    })
    const w = h.win
    await expect(w.locator('.agent-title')).toHaveText('Validasi email formulir', { timeout: 30_000 })
    await w.waitForTimeout(1200)
    await shot('01-start')

    await w.keyboard.press('Control+P')
    await w.keyboard.type('form.ts')
    await w.waitForTimeout(400)
    await w.keyboard.press('Enter')
    await w.waitForTimeout(1500)
    await shot('02-editor')

    await w.locator('.tool-card .tc-head', { hasText: 'form.ts' }).last().click()
    await w.locator('.tool-card .tc-head', { hasText: 'npm test' }).first().click().catch(() => {})
    await w.locator('.tool-card .tc-head', { hasText: 'Tinjau keamanan' }).first().click()
    await w.waitForTimeout(500)
    await shot('03-agent-cards')

    await w.locator(`.agent-head .icon-btn[data-tip="${L('Session overview')}"]`).click()
    await w.waitForTimeout(1500)
    await shot('04-overview')

    await w.locator(`.agent-head .icon-btn[data-tip="${L('Replay how Claude built it')}"]`).click()
    await w.waitForTimeout(1500)
    await shot('05-replay')
    await w.locator('.replay-step').first().click()
    await w.waitForTimeout(500)
    await shot('05b-replay-step1')

    await w.click(`.activity-item[data-tip="${L('Source control')}"]`)
    await w.waitForTimeout(1200)
    await shot('06-scm')
    await w.locator('.scm-row', { hasText: 'form.ts' }).first().click()
    await w.waitForTimeout(1800)
    await shot('07-diff')

    await w.click(`.activity-item[data-tip="${L('Search')}"]`)
    await w.keyboard.type('emailValid')
    await w.waitForTimeout(1500)
    await shot('08-search')

    await w.click(`.activity-item[data-tip="${L('Claude sessions')}"]`)
    await w.waitForTimeout(800)
    await shot('09-sessions')

    await w.click(`.activity-item[data-tip="${L('Explorer')}"]`)
    await w.waitForTimeout(400)
    await w.locator('.tree-row', { hasText: 'README.md' }).click({ button: 'right' })
    await w.waitForTimeout(300)
    await shot('10-context-menu')
    await w.keyboard.press('Escape')

    await w.keyboard.press('Control+Shift+P')
    await w.keyboard.type('claude')
    await w.waitForTimeout(400)
    await shot('11-palette')
    await w.keyboard.press('Escape')

    await w.keyboard.press('Control+`')
    await w.waitForTimeout(2500)
    await shot('12-terminal')

    await w.keyboard.press('Control+,')
    await w.waitForTimeout(800)
    await shot('13-settings')
    await w.locator('.set-nav-item', { hasText: 'Claude' }).click()
    await w.waitForTimeout(400)
    await shot('14-settings-claude')

    await w.locator('.tree-row', { hasText: 'README.md' }).click()
    await w.keyboard.press('Delete')
    await w.waitForTimeout(400)
    await shot('15-dialog')
    await w.keyboard.press('Escape')

    await w.locator(`.agent-head .icon-btn[data-tip="${L('More')}"]`).click()
    await w.locator('.ctx-item', { hasText: L('Close session in panel') }).click()
    await w.waitForTimeout(600)
    await shot('16-start-screen')
  })
}
