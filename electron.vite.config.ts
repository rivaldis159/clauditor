import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'

const shared = { '@shared': resolve('src/shared') }

/** A strict Content-Security-Policy for production builds; dev keeps Vite's inline preamble working. */
function cspPlugin(): Plugin {
  const prod = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: clauditor-file:",
    "media-src 'self' clauditor-file:",
    "font-src 'self' data: clauditor-file:",
    "worker-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'"
  ].join('; ')
  const dev = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: clauditor-file:",
    "media-src 'self' clauditor-file:",
    "font-src 'self' data: clauditor-file:",
    "worker-src 'self' blob:",
    "connect-src 'self' ws://localhost:* http://localhost:*",
    "object-src 'none'"
  ].join('; ')
  let isBuild = false
  return {
    name: 'clauditor-csp',
    configResolved(config) {
      isBuild = config.command === 'build'
    },
    transformIndexHtml(html) {
      return html.replace('%CSP%', isBuild ? prod : dev)
    }
  }
}

export default defineConfig({
  main: {
    resolve: { alias: shared },
    build: {
      // the Agent SDK is a devDependency: kept external so it is neither bundled nor packaged; the
      // installed app downloads it from npm on first run (services/claude/sdk.ts)
      externalizeDeps: { include: ['@anthropic-ai/claude-agent-sdk'] },
      rollupOptions: {
        input: { index: resolve('src/main/index.ts') }
      }
    }
  },
  preload: {
    resolve: { alias: shared },
    build: {
      externalizeDeps: true,
      rollupOptions: {
        input: { index: resolve('src/preload/index.ts') },
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: { '@': resolve('src/renderer/src'), ...shared }
    },
    plugins: [react(), cspPlugin()],
    worker: { format: 'es' },
    build: {
      chunkSizeWarningLimit: 8000,
      rollupOptions: {
        input: { index: resolve('src/renderer/index.html') }
      }
    }
  }
})
