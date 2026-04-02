# Message Rotation Plan

## Tujuan

Dokumen ini mendefinisikan rencana pengembangan untuk fitur pesan operator yang:

- dapat diisi langsung oleh operator
- mendukung banyak pesan
- menampilkan satu pesan pada satu waktu
- mengganti pesan secara otomatis seperti slideshow
- tetap kompatibel dengan mode Neutralino desktop dan mode web

Fokus utama:

- box pesan di panel kiri

Opsional tahap lanjut:

- daftar running text bawah yang juga bisa berganti otomatis

## Scope

### Fase inti

- operator dapat memasukkan banyak pesan untuk box kiri
- pesan disimpan ke settings
- pesan berputar otomatis dengan interval tertentu
- perubahan langsung tampil tanpa restart aplikasi

### Fase opsional

- operator dapat memasukkan banyak pesan untuk ticker bawah
- sistem memilih satu ticker aktif, lalu menggantinya secara periodik

## Kebutuhan Fungsional

### 1. Box pesan kiri

Operator dapat:

- menambah banyak pesan
- mengubah pesan yang sudah ada
- menghapus pesan
- menentukan urutan pesan
- menyimpan hasil edit

Sistem akan:

- menampilkan satu pesan aktif
- mengganti ke pesan berikutnya setelah interval tertentu
- loop kembali ke pesan pertama saat daftar habis
- fallback ke pesan default jika daftar kosong

### 2. Running text bawah

Tahap awal ada dua opsi implementasi:

1. tetap satu teks panjang seperti sekarang
2. mendukung beberapa pesan ticker yang diputar satu per satu

Keputusan yang disarankan:

- implementasikan rotasi multi-pesan dulu untuk box kiri
- pertahankan ticker bawah tetap satu teks pada fase pertama
- jika stabil, baru lanjutkan multi-ticker

## Struktur Data yang Disarankan

Tambahkan field baru ke settings:

```json
{
  "sideMessages": [
    "Perbanyak dzikir sebelum iqomah.",
    "Rapikan sandal di area pintu masuk.",
    "Mohon ponsel dalam mode senyap."
  ],
  "sideMessageIntervalMs": 10000,
  "tickerMessages": [
    "Mari jaga kekhusyukan masjid.",
    "Silakan rapikan sandal sebelum masuk shaf."
  ],
  "tickerMode": "single",
  "tickerMessageIntervalMs": 20000
}
```

Catatan:

- `sideMessages` adalah fitur utama
- `tickerMessages` bisa dipersiapkan dari awal tetapi tidak wajib langsung dipakai
- `tickerMode` bisa bernilai:
  - `single`
  - `rotate`

## Prinsip Arsitektur

Fitur ini sebaiknya tidak diletakkan langsung di `render.js`.

Gunakan service kecil khusus agar logic rotasi tidak bercampur dengan DOM rendering.

Service yang disarankan:

- `resources/js/services/messageRotator.js`

Tanggung jawab service:

- menyimpan daftar pesan aktif
- menyimpan index pesan saat ini
- menjadwalkan pergantian pesan
- reset rotasi saat daftar pesan berubah
- expose pesan aktif ke UI

## Desain Service

### Public API yang disarankan

```js
init({ messages, intervalMs, onChange })
update({ messages, intervalMs })
start()
stop()
getCurrent()
```

### Perilaku

- jika `messages.length === 0`, gunakan fallback default
- jika `messages.length === 1`, tidak perlu timer rotasi
- jika `messages.length > 1`, gunakan `setTimeout` tunggal
- setiap pergantian memanggil `onChange(currentMessage)`

### Kenapa bukan `setInterval`

`setTimeout` berantai lebih aman karena:

- lebih mudah di-reset saat daftar pesan berubah
- lebih kecil risiko overlap bila render lambat
- lebih konsisten dengan pola timer lain di app ini

## Integrasi Dengan Settings

### `resources/js/services/settings.js`

Tambahkan default:

- `sideMessages`
- `sideMessageIntervalMs`
- `tickerMessages`
- `tickerMode`
- `tickerMessageIntervalMs`

Persistence tetap memakai mekanisme settings yang sudah ada, jadi:

- di Neutralino tersimpan lewat storage native
- di web tersimpan lewat `localStorage`

## Integrasi Dengan Store

Ada dua opsi:

### Opsi A - simpan pesan aktif di store

Tambahkan key:

- `activeSideMessage`
- `activeTickerMessage`

Keuntungan:

- renderer tetap dumb
- perubahan pesan aktif mudah dipantau

### Opsi B - renderer membaca langsung dari service

Ini tidak saya sarankan karena:

- membuat dependency renderer ke timer/service
- lebih sulit dilacak

Keputusan yang disarankan:

- gunakan Opsi A

## Integrasi Dengan Renderer

### `resources/js/ui/render.js`

Tambahkan setter:

- `setSideMessage(text)`
- `setTickerMessage(text)`

Renderer hanya bertugas:

- mengisi `textContent` elemen
- menambahkan class transisi bila diperlukan

Tidak boleh mengatur timer rotasi.

## Integrasi Dengan Main Bootstrap

### `resources/js/main.js`

Tambahkan flow:

1. load settings
2. init rotator untuk pesan kiri
3. subscribe perubahan pesan aktif ke store
4. saat operator menyimpan daftar pesan baru:
   - save ke settings
   - update rotator
   - update store

Jika nanti ticker juga multi-pesan:

- bisa pakai rotator kedua
- atau service sama dengan instance terpisah

## UI Operator

### Fase paling pragmatis

Gunakan prompt atau textarea input sederhana.

Format input yang disarankan:

- satu baris = satu pesan

Contoh:

```text
Perbanyak dzikir sebelum iqomah.
Rapikan sandal di area pintu masuk.
Mohon ponsel dalam mode senyap.
```

Flow:

1. operator klik `Ubah Pesan Masjid`
2. muncul prompt/textarea
3. setiap baris diparsing menjadi item array
4. item kosong dibuang
5. hasil disimpan ke `sideMessages`

### Fase yang lebih proper

Jika nanti ingin UX lebih baik, buat modal operator khusus:

- daftar pesan
- tombol tambah
- tombol hapus
- tombol naik/turun urutan
- input interval

Keputusan yang disarankan:

- fase pertama pakai input multiline
- fase kedua baru modal editor

## Animasi Transisi Pesan

Pesan teks tidak perlu dianimasikan seheboh slideshow gambar.

Animasi yang disarankan:

- `fade + slight translateY`

Durasi:

- `300ms - 500ms`

Alasan:

- tetap halus
- tidak mengganggu keterbacaan
- murah untuk render

CSS yang disarankan:

- class masuk
- class keluar
- opacity dan transform ringan

## Aturan Saat State AZAN/IQOMAH

Ada dua opsi:

### Opsi 1

Pesan kiri tetap berputar terus di semua state

### Opsi 2

Rotasi pesan dipause saat:

- `AZAN`
- `IQOMAH`

Keputusan yang disarankan:

- pause saat `AZAN` dan `IQOMAH`
- lanjut lagi saat kembali `NORMAL`

Alasannya:

- fokus layar saat azan/iqomah harus ke waktu, bukan ke pergantian teks

## Validasi dan Sanitasi

Aturan minimal:

- trim whitespace tiap pesan
- buang item kosong
- batasi panjang maksimum, misalnya `220-300` karakter per pesan
- render dengan `textContent`, bukan `innerHTML`

Tujuannya:

- mencegah layout pecah
- mencegah injeksi HTML

## Fallback Policy

Jika `sideMessages` kosong:

- tampilkan fallback default bawaan aplikasi

Jika `tickerMessages` kosong dan ticker multi belum aktif:

- tampilkan ticker default saat ini

Jika rotator gagal init:

- tampilkan item pertama dari fallback

## Fase Implementasi

### Fase 1

- tambah struktur data baru di settings
- tambah field default

### Fase 2

- buat `messageRotator.js`
- rotasi hanya untuk box kiri

### Fase 3

- tambahkan `activeSideMessage` ke store
- sambungkan ke renderer

### Fase 4

- tambahkan aksi operator `Ubah Pesan Masjid`
- parsing multiline ke array

### Fase 5

- tambahkan animasi transisi teks
- uji pause/resume saat state berubah

### Fase 6

- evaluasi apakah ticker bawah perlu versi multi-pesan

## Acceptance Criteria

- operator bisa memasukkan banyak pesan
- pesan disimpan dan tetap ada setelah reload/reopen
- box kiri menampilkan satu pesan aktif
- pesan berganti otomatis sesuai interval
- jika daftar hanya satu item, pesan tetap stabil tanpa rotasi
- saat daftar kosong, fallback default tampil
- tidak ada gangguan ke logic jadwal, slideshow, atau FSM utama

## Keputusan Implementasi yang Disarankan

- implementasikan multi-pesan dulu hanya untuk box kiri
- ticker bawah tetap satu teks di fase awal
- pakai service rotator terpisah
- pakai input multiline untuk operator pada fase pertama
- pause rotasi saat `AZAN` dan `IQOMAH`

## Langkah Berikutnya

Urutan aman untuk implementasi:

1. tambah field baru di settings
2. buat service rotator
3. sambungkan ke store dan renderer
4. tambah editor operator sederhana
5. uji di mode web dan Neutralino
