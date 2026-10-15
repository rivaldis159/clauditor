; *** Inno Setup 6.5.0+ - pesan Bahasa Indonesia (diterjemahkan untuk installer Tinta) ***
;
; Catatan: jangan menambahkan titik (.) di akhir pesan yang aslinya tanpa titik,
; karena Inno Setup menambahkannya sendiri.

[LangOptions]
LanguageName=Bahasa Indonesia
LanguageID=$0421
LanguageCodePage=1252

[Messages]

; *** Judul aplikasi
SetupAppTitle=Instalasi
SetupWindowTitle=Instalasi - %1
UninstallAppTitle=Hapus Instalasi
UninstallAppFullTitle=Hapus Instalasi %1

; *** Umum
InformationTitle=Informasi
ConfirmTitle=Konfirmasi
ErrorTitle=Galat

; *** Pesan SetupLdr
SetupLdrStartupMessage=Program ini akan memasang %1. Lanjutkan?
LdrCannotCreateTemp=Tidak dapat membuat berkas sementara. Instalasi dibatalkan
LdrCannotExecTemp=Tidak dapat menjalankan berkas di folder sementara. Instalasi dibatalkan
HelpTextNote=

; *** Pesan galat saat mulai
LastErrorMessage=%1.%n%nGalat %2: %3
SetupFileMissing=Berkas %1 tidak ditemukan di folder instalasi. Perbaiki masalah ini atau dapatkan salinan program yang baru.
SetupFileCorrupt=Berkas instalasi rusak. Dapatkan salinan program yang baru.
SetupFileCorruptOrWrongVer=Berkas instalasi rusak atau tidak cocok dengan versi Instalasi ini. Perbaiki masalah ini atau dapatkan salinan program yang baru.
InvalidParameter=Parameter yang tidak sah diberikan pada baris perintah:%n%n%1
SetupAlreadyRunning=Instalasi sudah berjalan.
WindowsVersionNotSupported=Program ini tidak mendukung versi Windows di komputer Anda.
WindowsServicePackRequired=Program ini memerlukan %1 Service Pack %2 atau yang lebih baru.
NotOnThisPlatform=Program ini tidak dapat berjalan di %1.
OnlyOnThisPlatform=Program ini harus dijalankan di %1.
OnlyOnTheseArchitectures=Program ini hanya dapat dipasang pada Windows untuk arsitektur prosesor berikut:%n%n%1
WinVersionTooLowError=Program ini memerlukan %1 versi %2 atau yang lebih baru.
WinVersionTooHighError=Program ini tidak dapat dipasang pada %1 versi %2 atau yang lebih baru.
AdminPrivilegesRequired=Anda harus masuk sebagai administrator untuk memasang program ini.
PowerUserPrivilegesRequired=Anda harus masuk sebagai administrator atau anggota grup Power Users untuk memasang program ini.
SetupAppRunningError=Instalasi mendeteksi bahwa %1 sedang berjalan.%n%nTutup semua jendelanya sekarang, lalu klik OK untuk melanjutkan, atau Batal untuk keluar.
UninstallAppRunningError=Penghapus instalasi mendeteksi bahwa %1 sedang berjalan.%n%nTutup semua jendelanya sekarang, lalu klik OK untuk melanjutkan, atau Batal untuk keluar.

; *** Pertanyaan saat mulai
PrivilegesRequiredOverrideTitle=Pilih Mode Instalasi
PrivilegesRequiredOverrideInstruction=Pilih mode instalasi
PrivilegesRequiredOverrideText1=%1 dapat dipasang untuk semua pengguna (memerlukan hak administrator), atau hanya untuk Anda.
PrivilegesRequiredOverrideText2=%1 dapat dipasang hanya untuk Anda, atau untuk semua pengguna (memerlukan hak administrator).
PrivilegesRequiredOverrideAllUsers=Pasang untuk &semua pengguna
PrivilegesRequiredOverrideAllUsersRecommended=Pasang untuk &semua pengguna (disarankan)
PrivilegesRequiredOverrideCurrentUser=Pasang hanya untuk &saya
PrivilegesRequiredOverrideCurrentUserRecommended=Pasang hanya untuk &saya (disarankan)

; *** Galat lain
ErrorCreatingDir=Instalasi tidak dapat membuat folder "%1"
ErrorTooManyFilesInDir=Tidak dapat membuat berkas di folder "%1" karena isinya terlalu banyak

; *** Pesan umum instalasi
ExitSetupTitle=Keluar dari Instalasi
ExitSetupMessage=Instalasi belum selesai. Jika keluar sekarang, program tidak akan terpasang.%n%nAnda dapat menjalankan Instalasi lagi di lain waktu untuk menyelesaikannya.%n%nKeluar dari Instalasi?
AboutSetupMenuItem=&Tentang Instalasi...
AboutSetupTitle=Tentang Instalasi
AboutSetupMessage=%1 versi %2%n%3%n%nSitus %1:%n%4
AboutSetupNote=
TranslatorNote=

; *** Tombol
ButtonBack=< &Kembali
ButtonNext=&Lanjut >
ButtonInstall=&Pasang
ButtonOK=OK
ButtonCancel=Batal
ButtonYes=&Ya
ButtonYesToAll=Ya untuk &semua
ButtonNo=&Tidak
ButtonNoToAll=T&idak untuk semua
ButtonFinish=&Selesai
ButtonBrowse=&Telusuri...
ButtonWizardBrowse=T&elusuri...
ButtonNewFolder=&Buat folder baru

; *** Dialog "Pilih Bahasa"
SelectLanguageTitle=Pilih Bahasa Instalasi
SelectLanguageLabel=Pilih bahasa yang dipakai selama instalasi.

; *** Teks umum wizard
ClickNext=Klik Lanjut untuk meneruskan, atau Batal untuk keluar dari Instalasi.
BeveledLabel=
BrowseDialogTitle=Telusuri Folder
BrowseDialogLabel=Pilih folder pada daftar di bawah, lalu klik OK.
NewFolderName=Folder Baru

; *** Halaman "Selamat datang"
WelcomeLabel1=Selamat datang di Wizard Instalasi [name]
WelcomeLabel2=Wizard ini akan memasang [name/ver] di komputer Anda.%n%nSebaiknya tutup aplikasi lain sebelum melanjutkan.

; *** Halaman "Kata sandi"
WizardPassword=Kata Sandi
PasswordLabel1=Instalasi ini dilindungi kata sandi.
PasswordLabel3=Masukkan kata sandi, lalu klik Lanjut. Huruf besar dan kecil dibedakan.
PasswordEditLabel=&Kata sandi:
IncorrectPassword=Kata sandi yang Anda masukkan salah. Coba lagi.

; *** Halaman "Perjanjian Lisensi"
WizardLicense=Perjanjian Lisensi
LicenseLabel=Bacalah informasi penting berikut sebelum melanjutkan.
LicenseLabel3=Bacalah Perjanjian Lisensi berikut. Anda harus menyetujuinya sebelum melanjutkan instalasi.
LicenseAccepted=Saya &menyetujui perjanjian ini
LicenseNotAccepted=Saya &tidak menyetujui perjanjian ini

; *** Halaman "Informasi"
WizardInfoBefore=Informasi
InfoBeforeLabel=Bacalah informasi penting berikut sebelum melanjutkan.
InfoBeforeClickLabel=Jika sudah siap melanjutkan instalasi, klik Lanjut.
WizardInfoAfter=Informasi
InfoAfterLabel=Bacalah informasi penting berikut sebelum melanjutkan.
InfoAfterClickLabel=Jika sudah siap melanjutkan instalasi, klik Lanjut.

; *** Halaman "Informasi Pengguna"
WizardUserInfo=Informasi Pengguna
UserInfoDesc=Masukkan informasi Anda.
UserInfoName=&Nama pengguna:
UserInfoOrg=&Organisasi:
UserInfoSerial=Nomor &seri:
UserInfoNameRequired=Anda harus memasukkan nama.

; *** Halaman "Pilih Lokasi Tujuan"
WizardSelectDir=Pilih Lokasi Tujuan
SelectDirDesc=Di mana [name] akan dipasang?
SelectDirLabel3=Instalasi akan memasang [name] ke folder berikut.
SelectDirBrowseLabel=Untuk melanjutkan, klik Lanjut. Jika ingin memilih folder lain, klik Telusuri.
DiskSpaceGBLabel=Diperlukan ruang kosong minimal [gb] GB.
DiskSpaceMBLabel=Diperlukan ruang kosong minimal [mb] MB.
CannotInstallToNetworkDrive=Instalasi tidak dapat memasang ke drive jaringan.
CannotInstallToUNCPath=Instalasi tidak dapat memasang ke path UNC.
InvalidPath=Anda harus memasukkan path lengkap dengan huruf drive, misalnya:%n%nC:\APP%n%natau path UNC dengan bentuk:%n%n\\server\share
InvalidDrive=Drive atau share UNC yang Anda pilih tidak ada atau tidak dapat diakses. Pilih yang lain.
DiskSpaceWarningTitle=Ruang Disk Tidak Cukup
DiskSpaceWarning=Instalasi memerlukan ruang kosong minimal %1 KB, tetapi drive yang dipilih hanya memiliki %2 KB.%n%nTetap lanjutkan?
DirNameTooLong=Nama folder atau path terlalu panjang.
InvalidDirName=Nama folder tidak sah.
BadDirName32=Nama folder tidak boleh memuat karakter berikut:%n%n%1
DirExistsTitle=Folder Sudah Ada
DirExists=Folder:%n%n%1%n%nsudah ada. Tetap pasang ke folder tersebut?
DirDoesntExistTitle=Folder Tidak Ada
DirDoesntExist=Folder:%n%n%1%n%nbelum ada. Buat folder tersebut?

; *** Halaman "Pilih Komponen"
WizardSelectComponents=Pilih Komponen
SelectComponentsDesc=Komponen mana yang akan dipasang?
SelectComponentsLabel2=Centang komponen yang ingin dipasang dan hilangkan centang yang tidak. Klik Lanjut jika sudah siap.
FullInstallation=Instalasi lengkap
CompactInstallation=Instalasi ringkas
CustomInstallation=Instalasi khusus
NoUninstallWarningTitle=Komponen Sudah Ada
NoUninstallWarning=Instalasi mendeteksi komponen berikut sudah terpasang di komputer Anda:%n%n%1%n%nMenghilangkan centangnya tidak akan menghapus komponen tersebut.%n%nTetap lanjutkan?
ComponentSize1=%1 KB
ComponentSize2=%1 MB
ComponentsDiskSpaceGBLabel=Pilihan saat ini memerlukan ruang disk minimal [gb] GB.
ComponentsDiskSpaceMBLabel=Pilihan saat ini memerlukan ruang disk minimal [mb] MB.

; *** Halaman "Pilih Tugas Tambahan"
WizardSelectTasks=Pilih Tugas Tambahan
SelectTasksDesc=Tugas tambahan apa yang akan dijalankan?
SelectTasksLabel2=Pilih tugas tambahan yang ingin dijalankan saat memasang [name], lalu klik Lanjut.

; *** Halaman "Pilih Folder Menu Start"
WizardSelectProgramGroup=Pilih Folder Menu Start
SelectStartMenuFolderDesc=Di mana pintasan program akan dibuat?
SelectStartMenuFolderLabel3=Instalasi akan membuat pintasan program di folder Menu Start berikut.
SelectStartMenuFolderBrowseLabel=Untuk melanjutkan, klik Lanjut. Jika ingin memilih folder lain, klik Telusuri.
MustEnterGroupName=Anda harus memasukkan nama folder.
GroupNameTooLong=Nama folder atau path terlalu panjang.
InvalidGroupName=Nama folder tidak sah.
BadGroupName=Nama folder tidak boleh memuat karakter berikut:%n%n%1
NoProgramGroupCheck2=&Jangan buat folder Menu Start

; *** Halaman "Siap Memasang"
WizardReady=Siap Memasang
ReadyLabel1=Instalasi siap mulai memasang [name] di komputer Anda.
ReadyLabel2a=Klik Pasang untuk melanjutkan, atau Kembali jika ingin meninjau atau mengubah pengaturan.
ReadyLabel2b=Klik Pasang untuk melanjutkan instalasi.
ReadyMemoUserInfo=Informasi pengguna:
ReadyMemoDir=Lokasi tujuan:
ReadyMemoType=Jenis instalasi:
ReadyMemoComponents=Komponen terpilih:
ReadyMemoGroup=Folder Menu Start:
ReadyMemoTasks=Tugas tambahan:

; *** Halaman unduh (TDownloadWizardPage) dan DownloadTemporaryFile
DownloadingLabel2=Mengunduh berkas...
ButtonStopDownload=&Hentikan unduhan
StopDownload=Yakin ingin menghentikan unduhan?
ErrorDownloadAborted=Unduhan dibatalkan
ErrorDownloadFailed=Unduhan gagal: %1 %2
ErrorDownloadSizeFailed=Gagal mendapatkan ukuran: %1 %2
ErrorProgress=Kemajuan tidak sah: %1 dari %2
ErrorFileSize=Ukuran berkas tidak sah: seharusnya %1, ditemukan %2

; *** Halaman ekstraksi (TExtractionWizardPage) dan ExtractArchive
ExtractingLabel=Mengekstrak berkas...
ButtonStopExtraction=&Hentikan ekstraksi
StopExtraction=Yakin ingin menghentikan ekstraksi?
ErrorExtractionAborted=Ekstraksi dibatalkan
ErrorExtractionFailed=Ekstraksi gagal: %1

; *** Rincian kegagalan ekstraksi arsip
ArchiveIncorrectPassword=Kata sandi salah
ArchiveIsCorrupted=Arsip rusak
ArchiveUnsupportedFormat=Format arsip tidak didukung

; *** Halaman "Bersiap Memasang"
WizardPreparing=Bersiap Memasang
PreparingDesc=Instalasi sedang bersiap memasang [name] di komputer Anda.
PreviousInstallNotCompleted=Pemasangan/penghapusan program sebelumnya belum selesai. Komputer perlu dimulai ulang untuk menyelesaikannya.%n%nSetelah komputer dimulai ulang, jalankan Instalasi lagi untuk menyelesaikan pemasangan [name].
CannotContinue=Instalasi tidak dapat dilanjutkan. Klik Batal untuk keluar.
ApplicationsFound=Aplikasi berikut sedang memakai berkas yang perlu diperbarui oleh Instalasi. Sebaiknya izinkan Instalasi menutup aplikasi ini secara otomatis.
ApplicationsFound2=Aplikasi berikut sedang memakai berkas yang perlu diperbarui oleh Instalasi. Sebaiknya izinkan Instalasi menutup aplikasi ini secara otomatis. Setelah instalasi selesai, Instalasi akan mencoba menjalankannya kembali.
CloseApplications=&Tutup aplikasi secara otomatis
DontCloseApplications=&Jangan tutup aplikasi
ErrorCloseApplications=Instalasi tidak dapat menutup semua aplikasi secara otomatis. Sebaiknya tutup semua aplikasi yang memakai berkas yang perlu diperbarui sebelum melanjutkan.
PrepareToInstallNeedsRestart=Instalasi perlu memulai ulang komputer. Setelah itu, jalankan Instalasi lagi untuk menyelesaikan pemasangan [name].%n%nMulai ulang sekarang?

; *** Halaman "Memasang"
WizardInstalling=Memasang
InstallingLabel=Mohon tunggu, Instalasi sedang memasang [name] di komputer Anda.

; *** Halaman "Instalasi Selesai"
FinishedHeadingLabel=Menyelesaikan Wizard Instalasi [name]
FinishedLabelNoIcons=Instalasi telah selesai memasang [name] di komputer Anda.
FinishedLabel=Instalasi telah selesai memasang [name] di komputer Anda. Aplikasi dapat dijalankan melalui pintasan yang telah dibuat.
ClickFinish=Klik Selesai untuk keluar dari Instalasi.
FinishedRestartLabel=Untuk menyelesaikan pemasangan [name], komputer perlu dimulai ulang. Mulai ulang sekarang?
FinishedRestartMessage=Untuk menyelesaikan pemasangan [name], komputer perlu dimulai ulang.%n%nMulai ulang sekarang?
ShowReadmeCheck=Ya, saya ingin membaca berkas README
YesRadio=&Ya, mulai ulang komputer sekarang
NoRadio=&Tidak, saya akan memulai ulang nanti
RunEntryExec=Jalankan %1
RunEntryShellExec=Lihat %1

; *** "Instalasi Memerlukan Disk Berikutnya"
ChangeDiskTitle=Instalasi Memerlukan Disk Berikutnya
SelectDiskLabel2=Masukkan Disk %1 lalu klik OK.%n%nJika berkas pada disk ini ada di folder selain yang ditampilkan di bawah, masukkan path yang benar atau klik Telusuri.
PathLabel=&Path:
FileNotInDir2=Berkas "%1" tidak ditemukan di "%2". Masukkan disk yang benar atau pilih folder lain.
SelectDirectoryLabel=Tentukan lokasi disk berikutnya.

; *** Pesan tahap instalasi
SetupAborted=Instalasi tidak selesai.%n%nPerbaiki masalahnya lalu jalankan Instalasi lagi.
AbortRetryIgnoreSelectAction=Pilih tindakan
AbortRetryIgnoreRetry=&Coba lagi
AbortRetryIgnoreIgnore=&Abaikan galat dan lanjutkan
AbortRetryIgnoreCancel=Batalkan instalasi
RetryCancelSelectAction=Pilih tindakan
RetryCancelRetry=&Coba lagi
RetryCancelCancel=Batal

; *** Pesan status instalasi
StatusClosingApplications=Menutup aplikasi...
StatusCreateDirs=Membuat folder...
StatusExtractFiles=Mengekstrak berkas...
StatusDownloadFiles=Mengunduh berkas...
StatusCreateIcons=Membuat pintasan...
StatusCreateIniEntries=Membuat entri INI...
StatusCreateRegistryEntries=Membuat entri registri...
StatusRegisterFiles=Mendaftarkan berkas...
StatusSavingUninstall=Menyimpan informasi penghapus instalasi...
StatusRunProgram=Menyelesaikan instalasi...
StatusRestartingApplications=Menjalankan ulang aplikasi...
StatusRollback=Membatalkan perubahan...

; *** Galat lain
ErrorInternal2=Galat internal: %1
ErrorFunctionFailedNoCode=%1 gagal
ErrorFunctionFailed=%1 gagal; kode %2
ErrorFunctionFailedWithMessage=%1 gagal; kode %2.%n%3
ErrorExecutingProgram=Tidak dapat menjalankan berkas:%n%1

; *** Galat registri
ErrorRegOpenKey=Galat saat membuka kunci registri:%n%1\%2
ErrorRegCreateKey=Galat saat membuat kunci registri:%n%1\%2
ErrorRegWriteKey=Galat saat menulis ke kunci registri:%n%1\%2

; *** Galat INI
ErrorIniEntry=Galat saat membuat entri INI di berkas "%1".

; *** Galat penyalinan berkas
FileAbortRetryIgnoreSkipNotRecommended=&Lewati berkas ini (tidak disarankan)
FileAbortRetryIgnoreIgnoreNotRecommended=&Abaikan galat dan lanjutkan (tidak disarankan)
SourceIsCorrupted=Berkas sumber rusak
SourceDoesntExist=Berkas sumber "%1" tidak ada
SourceVerificationFailed=Verifikasi berkas sumber gagal: %1
VerificationSignatureDoesntExist=Berkas tanda tangan "%1" tidak ada
VerificationSignatureInvalid=Berkas tanda tangan "%1" tidak sah
VerificationKeyNotFound=Berkas tanda tangan "%1" memakai kunci yang tidak dikenal
VerificationFileNameIncorrect=Nama berkas tidak benar
VerificationFileTagIncorrect=Tag berkas tidak benar
VerificationFileSizeIncorrect=Ukuran berkas tidak benar
VerificationFileHashIncorrect=Hash berkas tidak benar
ExistingFileReadOnly2=Berkas yang ada tidak dapat diganti karena bersifat hanya-baca.
ExistingFileReadOnlyRetry=&Hapus atribut hanya-baca lalu coba lagi
ExistingFileReadOnlyKeepExisting=&Pertahankan berkas yang ada
ErrorReadingExistingDest=Terjadi galat saat membaca berkas yang ada:
FileExistsSelectAction=Pilih tindakan
FileExists2=Berkas sudah ada.
FileExistsOverwriteExisting=&Timpa berkas yang ada
FileExistsKeepExisting=&Pertahankan berkas yang ada
FileExistsOverwriteOrKeepAll=&Lakukan hal yang sama untuk konflik berikutnya
ExistingFileNewerSelectAction=Pilih tindakan
ExistingFileNewer2=Berkas yang ada lebih baru daripada yang akan dipasang Instalasi.
ExistingFileNewerOverwriteExisting=&Timpa berkas yang ada
ExistingFileNewerKeepExisting=&Pertahankan berkas yang ada (disarankan)
ExistingFileNewerOverwriteOrKeepAll=&Lakukan hal yang sama untuk konflik berikutnya
ErrorChangingAttr=Terjadi galat saat mengubah atribut berkas yang ada:
ErrorCreatingTemp=Terjadi galat saat membuat berkas di folder tujuan:
ErrorReadingSource=Terjadi galat saat membaca berkas sumber:
ErrorCopying=Terjadi galat saat menyalin berkas:
ErrorDownloading=Terjadi galat saat mengunduh berkas:
ErrorExtracting=Terjadi galat saat mengekstrak arsip:
ErrorReplacingExistingFile=Terjadi galat saat mengganti berkas yang ada:
ErrorRestartReplace=RestartReplace gagal:
ErrorRenamingTemp=Terjadi galat saat mengganti nama berkas di folder tujuan:
ErrorRegisterServer=Tidak dapat mendaftarkan DLL/OCX: %1
ErrorRegSvr32Failed=RegSvr32 gagal dengan kode keluar %1
ErrorRegisterTypeLib=Tidak dapat mendaftarkan type library: %1

; *** Penanda nama di daftar aplikasi
UninstallDisplayNameMark=%1 (%2)
UninstallDisplayNameMarks=%1 (%2, %3)
UninstallDisplayNameMark32Bit=32-bit
UninstallDisplayNameMark64Bit=64-bit
UninstallDisplayNameMarkAllUsers=Semua pengguna
UninstallDisplayNameMarkCurrentUser=Pengguna ini

; *** Galat setelah instalasi
ErrorOpeningReadme=Terjadi galat saat membuka berkas README.
ErrorRestartingComputer=Instalasi tidak dapat memulai ulang komputer. Lakukan secara manual.

; *** Pesan penghapus instalasi
UninstallNotFound=Berkas "%1" tidak ada. Tidak dapat menghapus instalasi.
UninstallOpenError=Berkas "%1" tidak dapat dibuka. Tidak dapat menghapus instalasi
UninstallUnsupportedVer=Format log penghapusan "%1" tidak dikenali oleh penghapus instalasi versi ini. Tidak dapat menghapus instalasi
UninstallUnknownEntry=Ditemukan entri yang tidak dikenal (%1) di log penghapusan
ConfirmUninstall=Yakin ingin menghapus %1 beserta semua komponennya?
UninstallOnlyOnWin64=Instalasi ini hanya dapat dihapus di Windows 64-bit.
OnlyAdminCanUninstall=Instalasi ini hanya dapat dihapus oleh pengguna dengan hak administrator.
UninstallStatusLabel=Mohon tunggu, %1 sedang dihapus dari komputer Anda.
UninstalledAll=%1 berhasil dihapus dari komputer Anda.
UninstalledMost=Penghapusan %1 selesai.%n%nBeberapa elemen tidak dapat dihapus dan bisa dihapus secara manual.
UninstalledAndNeedsRestart=Untuk menyelesaikan penghapusan %1, komputer perlu dimulai ulang.%n%nMulai ulang sekarang?
UninstallDataCorrupted=Berkas "%1" rusak. Tidak dapat menghapus instalasi

; *** Pesan tahap penghapusan
ConfirmDeleteSharedFileTitle=Hapus Berkas Bersama?
ConfirmDeleteSharedFile2=Sistem menunjukkan berkas bersama berikut tidak lagi dipakai program mana pun. Hapus berkas bersama ini?%n%nJika masih ada program yang memakainya lalu berkas ini dihapus, program tersebut mungkin tidak berfungsi dengan benar. Jika ragu, pilih Tidak. Membiarkan berkas ini tidak akan menimbulkan masalah.
SharedFileNameLabel=Nama berkas:
SharedFileLocationLabel=Lokasi:
WizardUninstalling=Status Penghapusan
StatusUninstalling=Menghapus %1...

; *** Alasan menahan shutdown
ShutdownBlockReasonInstallingApp=Sedang memasang %1.
ShutdownBlockReasonUninstallingApp=Sedang menghapus %1.

[CustomMessages]

NameAndVersion=%1 versi %2
AdditionalIcons=Pintasan tambahan:
CreateDesktopIcon=Buat pintasan di &desktop
CreateQuickLaunchIcon=Buat pintasan &Quick Launch
ProgramOnTheWeb=%1 di Web
UninstallProgram=Hapus instalasi %1
LaunchProgram=Jalankan %1
AssocFileExtension=&Kaitkan %1 dengan ekstensi berkas %2
AssocingFileExtension=Mengaitkan %1 dengan ekstensi berkas %2...
AutoStartProgramGroupDescription=Startup:
AutoStartProgram=Jalankan %1 secara otomatis
AddonHostProgramNotFound=%1 tidak ditemukan di folder yang Anda pilih.%n%nTetap lanjutkan?
