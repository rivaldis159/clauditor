import '@fontsource/ibm-plex-sans/400.css'
import '@fontsource/ibm-plex-sans/500.css'
import '@fontsource/ibm-plex-sans/600.css'
import '@fontsource/ibm-plex-sans/400-italic.css'
import '@fontsource-variable/jetbrains-mono/wght.css'
import '@fontsource-variable/jetbrains-mono/wght-italic.css'
import '@fontsource/instrument-serif/400.css'
import '@fontsource/instrument-serif/400-italic.css'
import '@xterm/xterm/css/xterm.css'
import './styles/tokens.css'
import './styles/base.css'
import './styles/workbench.css'
import './styles/sidebar.css'
import './styles/editor.css'
import './styles/agent.css'
import './styles/panel.css'
import './styles/overlays.css'
import './styles/pages.css'

import { createRoot } from 'react-dom/client'
import { App } from './App'
import { bootstrap } from './bootstrap'

void bootstrap().finally(() => {
  createRoot(document.getElementById('root')!).render(<App />)
})
