// Walk through the main surfaces and capture each.
export default async function ({ win, shot }) {
  const wait = (ms) => win.waitForTimeout(ms)
  // sessions view
  await win.click('.activity-item[data-tip="Claude sessions"]')
  await wait(800)
  await shot('01-sessions')
  // activate the first live session
  const live = win.locator('.session-group').first().locator('.session-row').first()
  await live.click()
  await wait(3500)
  await shot('02-live-session')
  // quick open a file
  await win.keyboard.press('Control+P')
  await wait(400)
  await win.keyboard.type('src/main/index.ts')
  await wait(600)
  await shot('03-quickopen')
  await win.keyboard.press('Enter')
  await wait(1500)
  await shot('04-editor')
  // terminal
  await win.keyboard.press('Control+`')
  await wait(2500)
  await shot('05-terminal')
  // command palette
  await win.keyboard.press('Control+Shift+P')
  await wait(400)
  await win.keyboard.type('tema')
  await wait(300)
  await shot('06-palette')
  await win.keyboard.press('Escape')
  // git view
  await win.click('.activity-item[data-tip="Source control"]')
  await wait(800)
  await shot('07-scm')
  // search view
  await win.click('.activity-item[data-tip="Search"]')
  await wait(300)
  await win.keyboard.type('TranscriptParser')
  await wait(1500)
  await shot('08-search')
}
