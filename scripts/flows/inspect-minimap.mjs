export default async function ({ win, shot }) {
  await win.keyboard.press('Control+P')
  await win.waitForTimeout(300)
  await win.keyboard.type('README.md')
  await win.waitForTimeout(500)
  await win.keyboard.press('Enter')
  await win.waitForTimeout(1500)
  const res = await win.evaluate(() => {
    const c = document.querySelector('.code-host .minimap canvas')
    const ctx = c.getContext('2d', { willReadFrequently: true })
    const d = ctx.getImageData(0, 0, c.width, c.height).data
    let translucent = 0
    let first = null
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 255) {
        translucent++
        if (!first) first = { x: (i / 4) % c.width, y: Math.floor(i / 4 / c.width), a: d[i + 3], rgb: [d[i], d[i + 1], d[i + 2]] }
      }
    }
    const style = c.getAttribute('style')
    const mm = document.querySelector('.code-host .minimap')
    return { translucent, total: d.length / 4, first, style, mmStyle: mm.getAttribute('style'), canvasStyleComputed: getComputedStyle(c).opacity + ' ' + getComputedStyle(c).mixBlendMode }
  })
  console.log(JSON.stringify(res))
}
