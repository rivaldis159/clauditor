# Third-party notices

Clauditor's own code is MIT-licensed (see [LICENSE](LICENSE)). The application bundles the open-source
components below; each keeps its own license, whose full text ships inside the respective package
(`node_modules/<name>/LICENSE`) and, for Electron and Chromium, in `LICENSE.electron.txt` and
`LICENSES.chromium.html` next to `Clauditor.exe`.

| Component | Version | License |
|---|---|---|
| [Electron](https://github.com/electron/electron) (with Chromium and Node.js) | 44.7.2 | MIT (Chromium: see `LICENSES.chromium.html`) |
| [Monaco Editor](https://github.com/microsoft/monaco-editor) | 0.57.0 | MIT |
| [xterm.js](https://github.com/xtermjs/xterm.js) and addons (fit, search, unicode11, web-links, webgl) | 6.0.0 | MIT |
| [node-pty](https://github.com/microsoft/node-pty) (with ConPTY binaries) | 1.1.0 | MIT |
| [@vscode/ripgrep](https://github.com/microsoft/vscode-ripgrep) / [ripgrep](https://github.com/BurntSushi/ripgrep) | 1.18.0 | MIT (ripgrep: MIT or Unlicense) |
| [React](https://github.com/facebook/react) and React DOM | 19.3.0 | MIT |
| [Zustand](https://github.com/pmndrs/zustand) | 5.0.15 | MIT |
| [Lucide](https://github.com/lucide-icons/lucide) (lucide-react) | 1.57.0 | ISC |
| [react-markdown](https://github.com/remarkjs/react-markdown) / [remark-gfm](https://github.com/remarkjs/remark-gfm) | 10.1.0 / 4.0.1 | MIT |
| [fuzzysort](https://github.com/farzher/fuzzysort) | 4.0.2 | MIT |
| [TanStack Virtual](https://github.com/TanStack/virtual) | 3.14.19 | MIT |
| [Material Icon Theme](https://github.com/material-extensions/vscode-material-icon-theme) (file icons) | 5.39.0 | MIT |
| [jsdiff](https://github.com/kpdecker/jsdiff) (diff) | 9.0.0 | BSD-3-Clause |
| [ws](https://github.com/websockets/ws) | 8.22.0 | MIT |
| [IBM Plex Sans](https://github.com/IBM/plex) (via Fontsource) | 5.3.0 | SIL Open Font License 1.1 |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) (via Fontsource) | 5.3.0 | SIL Open Font License 1.1 |
| [Instrument Serif](https://github.com/Instrument/instrument-serif) (via Fontsource) | 5.3.0 | SIL Open Font License 1.1 |

The installer is built with [Inno Setup](https://jrsoftware.org/isinfo.php) (Inno Setup license); the
Indonesian installer messages in `build/Indonesian.isl` were translated for this project.

## Not included

These are used by Clauditor but are **not** distributed with it — they belong to Anthropic and are obtained
under Anthropic's terms:

- **Claude Code** (`claude.exe`) — Clauditor runs the copy installed with Claude desktop.
- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`) — downloaded by the app from the npm registry on
  first use ([terms](https://code.claude.com/docs/en/legal-and-compliance)); a development dependency only.
- **Claude's fonts** (Anthropic Sans, Serif, Mono) — read from the Claude desktop installation at runtime.

Claude, Claude Code and Claude desktop are trademarks of Anthropic, PBC. Clauditor is an independent
project and is not affiliated with or endorsed by Anthropic.
