// Electron helper for scripts/make-icons.mjs: renders one HTML page offscreen and writes PNG crops.
// usage: electron scripts/icon-render.cjs <job.json>
//   job.json: { "html": "<abs .html>", "width": 800, "height": 600,
//               "crops": [{ "x": 0, "y": 0, "width": 256, "height": 256, "out": "<abs .png>" }] }
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')

app.commandLine.appendSwitch('force-device-scale-factor', '1')
app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const job = JSON.parse(fs.readFileSync(process.argv[process.argv.length - 1], 'utf8'))
  const win = new BrowserWindow({
    width: job.width,
    height: job.height,
    useContentSize: true,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    webPreferences: { offscreen: true }
  })
  await win.loadFile(job.html)
  await new Promise((r) => setTimeout(r, 300))
  const page = await win.webContents.capturePage()
  const { width, height } = page.getSize()
  const sx = width / job.width
  const sy = height / job.height
  for (const c of job.crops) {
    let img = page.crop({ x: Math.round(c.x * sx), y: Math.round(c.y * sy), width: Math.round(c.width * sx), height: Math.round(c.height * sy) })
    if (img.getSize().width !== c.width) img = img.resize({ width: c.width, height: c.height, quality: 'best' })
    fs.writeFileSync(c.out, img.toPNG())
  }
  app.quit()
})
