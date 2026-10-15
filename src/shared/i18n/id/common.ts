// Indonesian — Strings shared across the UI and the Claude integration (versions, fonts, models, updates).
export const common: Record<string, string> = {
  // effort level not known to this release (a level Claude Code added later)
  '{level} effort': 'Usaha {level}',
  'Default (recommended)': 'Bawaan (disarankan)',

  // finished tool cards: English switches to the past tense, Indonesian keeps the same verb
  'done::Edited': 'Mengedit',
  'done::Wrote': 'Menulis',
  'done::Created': 'Membuat',
  'done::Edited notebook': 'Mengedit notebook',
  'done::Read': 'Membaca',
  'done::Ran': 'Menjalankan',
  'done::Read output': 'Membaca keluaran',
  'done::Stopped process': 'Menghentikan proses',
  'done::Searched': 'Mencari',
  'done::Found files': 'Mencari berkas',
  'done::Listed folder': 'Melihat folder',
  'done::Fetched': 'Membuka',
  'done::Searched the web': 'Mencari di web',
  'done::Updated plan': 'Memperbarui rencana',
  'done::Added task': 'Menambah tugas',
  'done::Updated task': 'Memperbarui tugas',
  'done::Listed tasks': 'Melihat tugas',
  'done::Proposed plan': 'Mengajukan rencana',
  'done::Asked a question': 'Bertanya',
  'done::Used skill': 'Memakai skill',
  'done::Loaded tools': 'Memuat alat',
  'done::Called': 'Memanggil',
  'done::Used': 'Memakai',

  // Settings → Claude → integration
  'Claude integration': 'Integrasi Claude',
  'Read from Claude itself and checked again whenever Claude updates, so models, fonts and Claude Code stay in step with Claude desktop.':
    'Dibaca langsung dari Claude dan diperiksa ulang setiap kali Claude diperbarui, sehingga model, font, dan Claude Code selalu selaras dengan Claude desktop.',
  'Claude desktop': 'Claude desktop',
  'Microsoft Store': 'Microsoft Store',
  'Classic installer': 'Pemasang klasik',
  'Agent SDK': 'Agent SDK',
  'from npm, made for Claude Code {version}': 'dari npm, dibuat untuk Claude Code {version}',
  'from node_modules (development)': 'dari node_modules (pengembangan)',
  'downloaded from npm on first use': 'diunduh dari npm saat pertama dipakai',
  Fonts: 'Font',
  "Claude's fonts (Anthropic Sans, Serif and Mono)": 'Font Claude (Anthropic Sans, Serif, dan Mono)',
  'Fallback fonts — Claude desktop not found': 'Font cadangan — Claude desktop tidak ditemukan',
  Models: 'Model',
  'Check now': 'Periksa sekarang',
  'Last checked {when}': 'Terakhir diperiksa {when}',
  'Keep the Agent SDK in sync with Claude': 'Selaraskan Agent SDK dengan Claude',
  "Claude's Agent SDK is fetched from npm on first use, and again whenever Claude desktop brings a newer Claude Code. Turn this off to keep the copy you have.":
    'Agent SDK milik Claude diambil dari npm saat pertama dipakai, dan lagi setiap kali Claude desktop membawa Claude Code yang lebih baru. Matikan untuk tetap memakai salinan yang ada.',
  'Levels offered by Claude Code for the default model.': 'Tingkat yang disediakan Claude Code untuk model bawaan.',
  'The default model has no effort setting.': 'Model bawaan tidak memiliki pengaturan usaha.',
  'Could not check Claude': 'Gagal memeriksa Claude',

  // About: independence statement, license, source
  'Clauditor is an independent community project, not affiliated with, endorsed by, or sponsored by Anthropic. Claude, Claude Code and Claude desktop are trademarks of Anthropic, PBC.':
    'Clauditor adalah proyek komunitas independen yang tidak berafiliasi dengan, tidak didukung, dan tidak disponsori oleh Anthropic. Claude, Claude Code, dan Claude desktop adalah merek dagang Anthropic, PBC.',
  License: 'Lisensi',
  'Source code': 'Kode sumber',

  // update notices
  'Claude desktop updated to {version}': 'Claude desktop diperbarui ke {version}',
  'Claude Code updated to {version}': 'Claude Code diperbarui ke {version}',
  'Agent SDK updated to {version}': 'Agent SDK diperbarui ke {version}',
  'Clauditor now drives Claude Code with the matching SDK.': 'Clauditor kini menjalankan Claude Code dengan SDK yang sesuai.',
  'Clauditor picked up the new version automatically.': 'Clauditor otomatis memakai versi baru tersebut.'
}
