// Welcome page scrolled to the shortcuts list: every label must fit without an ellipsis.
import fs from 'node:fs'
import path from 'node:path'

export default async function ({ win, outDir, shot }) {
  await win.waitForSelector('.welcome', { timeout: 30000 })
  await win.waitForTimeout(1500)
  await win.evaluate(() => {
    const page = document.querySelector('.page.welcome')
    if (page) page.scrollTop = page.scrollHeight
  })
  await win.waitForTimeout(400)
  await shot('k1-shortcuts')
  // a label is cut off when its content is wider than its box
  const cut = await win.evaluate(() =>
    [...document.querySelectorAll('.welcome *')]
      .filter((el) => el.children.length === 0 && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).textOverflow === 'ellipsis')
      .map((el) => el.textContent.trim())
  )
  fs.writeFileSync(path.join(outDir, 'cut.txt'), cut.join('\n') || '(none)')
}
