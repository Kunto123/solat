# UI Revision Plan

## Tujuan

Dokumen ini menjadi acuan revisi tampilan aplikasi signage masjid dengan batasan:

- tetap mempertahankan stack `Neutralinojs + Vanilla JS + HTML + CSS`
- tidak mengubah engine utama yang sudah berjalan lancar kecuali yang diperlukan untuk mapping UI
- memakai referensi layout dari `layout.png`
- memakai logo tetap dari `resources/assets/fallback/logo-masjid.png`
- memakai tema warna utama biru, sederhana, bersih, dan mudah dibaca dari jarak jauh

## Referensi Visual

- Layout utama: `c:/Users/dwiku/Downloads/layout.png`
- Referensi keterbacaan/kepadatan informasi: `c:/Users/dwiku/Downloads/Screenshot_20260402_072843_WhatsApp.jpg`
- Logo masjid: `resources/assets/fallback/logo-masjid.png`

## Prinsip Desain

- Prioritas utama adalah keterbacaan layar TV/monitor dari jarak jauh.
- Layout dibuat stabil; state `NORMAL`, `AZAN`, dan `IQOMAH` tidak boleh memicu pergeseran besar.
- Warna dominan biru dipakai pada header, aksen, highlight, dan panel waktu.
- Panel informasi utama memakai latar terang atau putih agar angka dan teks lebih tegas.
- Efek visual dibuat minimal: shadow lembut, radius sedang, tanpa glow berlebihan.
- Slideshow tetap penting, tetapi tampil sebagai panel konten kanan, bukan latar penuh yang bersaing dengan teks.

## Struktur Layout Target

Layout dibagi menjadi tiga area utama:

1. Kolom kiri
2. Konten kanan
3. Bar bawah penuh

### 1. Kolom kiri

Fungsi:

- tanggal Indonesia
- tanggal Hijriah
- jam besar
- countdown menuju waktu sholat berikutnya atau status aktif
- panel teks tambahan

Komponen target:

- `left-panel`
- `date-gregorian`
- `date-hijri`
- `clock-card`
- `clock`
- `next-countdown-card`
- `next-prayer-summary`
- `side-message-panel`

Catatan:

- `clock` yang sudah ada tetap dipakai.
- `date` yang sudah ada akan dipecah menjadi tanggal Indonesia dan tanggal Hijriah.
- `current-prayer` akan dipindah menjadi bagian dari panel countdown/status agar lebih dekat dengan jam.

### 2. Konten kanan

Fungsi:

- logo
- nama masjid
- alamat masjid
- panel slideshow utama

Komponen target:

- `top-header`
- `masjid-logo`
- `masjid-meta`
- `masjid-name`
- `masjid-address`
- `hero-panel`
- `slideshow-shell`

Catatan:

- slideshow engine saat ini tetap dipakai
- elemen `slide-active`, `slide-staging`, dan `slide-fallback` dipindah ke dalam panel slideshow kanan
- logo menggunakan file tetap `resources/assets/fallback/logo-masjid.png`

### 3. Bar bawah penuh

Fungsi:

- daftar seluruh waktu sholat
- running text

Komponen target:

- `prayer-strip`
- `prayer-card-*`
- `ticker-bar`
- `ticker-track`

Item jadwal minimal:

- Imsak
- Subuh
- Syuruq atau Dhuha
- Zuhur
- Ashar
- Maghrib
- Isya

Catatan:

- jika provider saat ini belum memiliki salah satu item tambahan, tampilkan fallback atau sembunyikan item secara terkontrol
- running text dibuat sederhana dan ringan terhadap performa

## Pemetaan Dari Struktur Saat Ini

### Elemen yang dipertahankan

- `#clock`
- `#slide-active`
- `#slide-staging`
- `#slide-fallback`
- `#error-overlay`
- `#operator-panel`
- `#op-tap-zone`
- `#fsm-badge`

Alasan:

- elemen-elemen ini sudah terhubung ke service aktif atau dev/operator flow

### Elemen yang perlu dipindah atau dipecah

- `#date`
  - dipecah menjadi tanggal Indonesia dan tanggal Hijriah
- `#current-prayer`
  - dipindah ke panel kiri sebagai status utama
- `#next-prayer-name`
  - dipakai ulang untuk ringkasan waktu berikutnya
- `#next-prayer-time`
  - dipakai ulang untuk jam azan berikutnya
- `#iqomah-countdown`
  - ditaruh di area status kiri, bukan di footer lama

### Elemen yang kemungkinan dihapus atau diganti

- `#overlay`
- `#info-bar`
- `#info-divider`
- `#next-prayer-block`
- `#prayer-status`
- `#clock-section`

Alasan:

- struktur lama dibuat untuk mode fullscreen dengan slideshow sebagai background penuh
- target layout baru membutuhkan panel-panel yang lebih tetap dan eksplisit

### Elemen baru yang perlu ditambahkan

- `#date-gregorian`
- `#date-hijri`
- `#next-prayer-summary`
- `#side-message-panel`
- `#masjid-logo`
- `#masjid-name`
- `#masjid-address`
- `#prayer-strip`
- `#ticker-bar`
- `#ticker-track`

## Data Tambahan yang Dibutuhkan

Selain data yang sudah ada, UI baru perlu sumber data untuk:

- nama masjid
- alamat masjid
- teks berjalan
- teks panel kiri
- tanggal Hijriah

Strategi tahap awal:

- nama masjid, alamat, dan running text diisi placeholder statis lebih dulu
- tanggal Hijriah dapat memakai formatter lokal sederhana atau placeholder jika implementasinya dipisah
- setelah UI stabil, data ini bisa dipindah ke `settings` atau provider konfigurasi

## Rencana Perubahan File

### `resources/index.html`

Perubahan:

- menyusun ulang markup utama menjadi layout dua kolom + strip bawah
- memindahkan container slideshow ke panel kanan
- menambahkan slot logo, nama masjid, alamat, prayer strip, dan ticker

Risiko:

- renderer saat ini mengandalkan beberapa ID lama
- perlu menjaga kompatibilitas ID atau menyesuaikan renderer secara terkontrol

### `resources/styles.css`

Perubahan:

- mengganti layout fullscreen lama menjadi grid signage baru
- menambahkan design tokens warna biru
- membuat komponen panel/card yang konsisten
- menambahkan style logo, slideshow shell, prayer strip, dan ticker

Risiko:

- style lama sangat terikat pada layout vertikal penuh
- perlu pembersihan selektor lama agar tidak konflik

### `resources/js/ui/render.js`

Perubahan:

- menambah referensi elemen DOM baru
- memisah render tanggal Indonesia dan tanggal Hijriah
- merender ringkasan status di panel kiri
- merender prayer strip bawah
- merender ticker bila data sudah tersedia

Risiko:

- provider saat ini mungkin belum menyediakan seluruh item jadwal yang diminta layout

### `resources/js/main.js`

Perubahan kecil yang mungkin diperlukan:

- injeksi data awal untuk nama masjid, alamat, dan pesan statis jika belum ada provider khusus

Catatan:

- tidak boleh ada refactor logic besar pada tahap revisi visual ini

### `resources/js/services/settings.js`

Opsional:

- tahap awal tidak wajib diubah
- tahap lanjutan dapat ditambah field konfigurasi untuk nama masjid, alamat, pesan samping, dan ticker

## Palet Warna Awal

Palet yang disarankan:

- `--color-primary: #1f5fae`
- `--color-primary-strong: #164d91`
- `--color-primary-soft: #dcecff`
- `--color-surface: #ffffff`
- `--color-surface-muted: #f3f7fc`
- `--color-bg: #eaf2fb`
- `--color-text: #12304f`
- `--color-text-soft: #45627f`
- `--color-success: #1aa36f`
- `--color-warning: #f0a23b`

Penggunaan:

- header dan aksen utama memakai biru
- kartu jadwal bawah memakai putih dengan highlight biru atau hijau
- countdown dan state azan/iqomah tetap punya aksen khusus tetapi tidak dominan berlebihan

## Tipografi dan Keterbacaan

- tetap gunakan font sistem yang stabil untuk sekarang
- angka jam harus paling dominan secara visual
- nama masjid dan jadwal bawah harus terbaca cepat
- hindari teks tipis berlebihan
- angka jadwal sholat gunakan `tabular-nums` agar stabil

## Strategi State Visual

### NORMAL

- warna dominan biru/putih
- slideshow berjalan normal
- countdown berikutnya tampil tenang

### AZAN

- highlight status aktif dan countdown iqomah
- slideshow bisa tetap jalan atau dibekukan; keputusan final mengikuti perilaku existing app
- warna aksen dapat bergeser ke biru lebih kuat atau amber ringan

### IQOMAH

- fokus pada countdown
- panel kiri menjadi pusat perhatian

### ERROR

- overlay error tetap dipertahankan seperti sekarang

## Fase Implementasi Revisi

### Fase A - Blueprint markup

- susun target DOM tree baru
- pastikan semua ID penting terpetakan
- tentukan elemen yang tetap dan yang diganti

Output:

- revisi `index.html`

### Fase B - Tema dan layout CSS

- implement grid utama
- buat card biru-putih yang sederhana
- tempatkan slideshow ke panel kanan
- buat prayer strip bawah dan ticker

Output:

- revisi `styles.css`

### Fase C - Integrasi renderer

- sambungkan renderer ke elemen baru
- pecah tanggal menjadi dua baris
- tampilkan prayer summary dan prayer strip

Output:

- revisi `render.js`

### Fase D - Placeholder content

- isi logo masjid
- isi nama/alamat placeholder
- isi teks ticker dan panel samping

Output:

- penambahan data awal atau konstanta sederhana

### Fase E - Verifikasi signage

- cek layout di 1366x768 dan 1920x1080
- cek state `NORMAL`, `AZAN`, `IQOMAH`, `ERROR`
- cek slideshow tetap stabil
- cek operator panel tidak tertutup elemen baru

## Acceptance Criteria

- layout mengikuti komposisi utama dari `layout.png`
- logo tampil dari `resources/assets/fallback/logo-masjid.png`
- warna utama tampak biru dan sederhana
- jam tetap dominan dan terbaca jelas
- slideshow tampil di panel kanan, bukan lagi background penuh dominan
- daftar jadwal bawah tampil rapi dan konsisten
- running text hadir di bagian bawah
- tidak ada regresi pada jam, state sholat, iqomah, slideshow, error overlay, dan operator panel

## Keputusan Implementasi yang Disarankan

- implementasi dilakukan sebagai revisi visual bertahap, bukan refactor arsitektur besar
- jaga service dan FSM tetap stabil
- utamakan perubahan pada `HTML + CSS + render.js`
- semua data baru yang belum final diisi placeholder dulu

## Langkah Berikutnya

Urutan aman untuk mulai implementasi:

1. Rebuild `resources/index.html` sesuai blueprint ini
2. Rebuild `resources/styles.css` ke tema biru sederhana
3. Adaptasi `resources/js/ui/render.js`
4. Uji state dan slideshow
5. Baru pertimbangkan memasukkan nama/alamat/ticker ke settings
