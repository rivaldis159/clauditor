// Indonesian — Text produced by the main process (notifications, runner errors, terminal and IDE bridge messages).
export const main: Record<string, string> = {
  // notifications
  'Claude needs your permission': 'Claude meminta izin',
  '{tool} — open Clauditor to respond': '{tool} — buka Clauditor untuk menanggapi',
  'Claude finished': 'Claude selesai',
  'Turn complete': 'Giliran selesai',
  'Claude finished working': 'Claude selesai bekerja',

  // dialogs and errors
  'Open folder': 'Buka folder',
  'Choose file': 'Pilih berkas',
  'Terminal profile not available: {id}': 'Profil terminal tidak tersedia: {id}',
  'Folder not found: {path}': 'Folder tidak ditemukan: {path}',
  'Already exists: {name}': 'Sudah ada: {name}',
  'Cannot write the lock file: {error}': 'Tidak dapat menulis lock file: {error}',
  'Not a git repository': 'Bukan repositori git',

  // Claude Code runner
  'Deny {rules} for this session': 'Tolak {rules} untuk sesi ini',
  'Allow {rules} for this session': 'Izinkan {rules} untuk sesi ini',
  'Deny {rules} in this project': 'Tolak {rules} di proyek ini',
  'Allow {rules} in this project': 'Izinkan {rules} di proyek ini',
  'Always deny {rules}': 'Tolak {rules} selalu',
  'Always allow {rules}': 'Izinkan {rules} selalu',
  'Switch mode to {mode}': 'Ganti mode ke {mode}',
  'Allow access to {dirs}': 'Izinkan akses folder {dirs}',
  'Permission rule': 'Aturan izin',
  'Claude Code in Clauditor is not signed in, or its login has expired. Click "Sign in" to log in once in a terminal. Sessions from Claude desktop can still be followed without signing in.':
    'Claude Code di Clauditor belum masuk, atau sesi loginnya sudah kedaluwarsa. Klik "Masuk" untuk login sekali lewat terminal. Sesi dari Claude desktop tetap bisa diikuti tanpa login.',
  'Claude Code was not found. Install Claude desktop or set the location of claude.exe in Settings.':
    'Claude Code tidak ditemukan. Pasang Claude desktop atau atur lokasi claude.exe di Pengaturan.',
  Failed: 'Gagal',
  "Clauditor couldn't download Claude's Agent SDK from npm. Check your internet connection, then try again.":
    'Clauditor gagal mengunduh Agent SDK milik Claude dari npm. Periksa koneksi internet, lalu coba lagi.',
  'Session not found': 'Sesi tidak ditemukan',
  'This session has stopped — start or resume a new one': 'Sesi sudah berhenti — mulai atau lanjutkan sesi baru',

  // timeline notices written while reading transcripts
  'Conversation summarized to fit in the context window': 'Percakapan diringkas agar tetap muat di konteks',
  'Stopped by user': 'Dihentikan oleh pengguna',
  'Context compacted manually from {k}k tokens': 'Konteks diringkas (manual) dari {k}k token',
  'Context compacted automatically from {k}k tokens': 'Konteks diringkas (otomatis) dari {k}k token',
  'Context compacted manually': 'Konteks diringkas (manual)',
  'Context compacted automatically': 'Konteks diringkas (otomatis)',
  '{detail} — attempt {n} of {max}': '{detail} — percobaan {n}/{max}',
  'API error': 'Kesalahan API',
  'Hook failed: {errors}': 'Hook gagal: {errors}',
  'File changed outside Claude: {file}': 'Berkas diubah di luar Claude: {file}'
}
