# Prayer API Sync Plan

## Tujuan

Dokumen ini mendefinisikan desain operasional untuk integrasi jadwal sholat online menggunakan API `myQuran v3` dengan strategi:

- online-first untuk sinkronisasi
- offline-first untuk runtime aplikasi
- cache lokal berbasis JSON
- pembacaan runtime selalu dari cache lokal, bukan langsung dari API

Tujuan utama:

- aplikasi tetap bisa berjalan stabil saat offline
- jadwal dapat diperbarui otomatis saat internet tersedia
- data jadwal 1 tahun ke depan dapat disiapkan lebih awal
- sumber data dapat diganti di masa depan tanpa merusak layer UI/FSM

## Sumber API

Sumber yang dipakai:

- Dokumentasi: `https://api.myquran.com/v3/doc`
- OpenAPI spec: `https://api.myquran.com/v3/doc/apimuslim`

Endpoint yang relevan untuk modul sholat:

- `GET /sholat`
- `GET /sholat/kabkota/semua`
- `GET /sholat/kabkota/{id}`
- `GET /sholat/kabkota/cari/{keyword}`
- `GET /sholat/jadwal/{id}/today`
- `GET /sholat/jadwal/{id}/{period}`

Catatan penting:

- `id` lokasi menggunakan string hash, bukan kode numerik sederhana
- `period` mendukung:
  - `YYYY-MM` untuk jadwal bulanan
  - `YYYY-MM-DD` untuk jadwal harian
- tidak ada endpoint tahunan langsung

Kesimpulan desain:

- untuk menyimpan jadwal 1 tahun ke depan, aplikasi harus melakukan loop `12 request bulanan`

## Keputusan Arsitektur

Runtime aplikasi harus tetap membaca dari cache lokal.

API hanya dipakai untuk:

- pencarian lokasi
- initial bootstrap jadwal
- refresh jadwal berkala saat online

Struktur service yang disarankan:

1. `PrayerLocationService`
2. `PrayerApiService`
3. `PrayerCacheService`
4. `PrayerSyncService`
5. `PrayerScheduleProvider`

### 1. `PrayerLocationService`

Tanggung jawab:

- mencari lokasi berdasarkan keyword
- memvalidasi pilihan operator
- menyimpan metadata lokasi aktif

Input:

- keyword pencarian, misalnya `bogor`

Output:

- `locationId`
- `kabko`
- `prov`

### 2. `PrayerApiService`

Tanggung jawab:

- request data ke API myQuran
- menangani timeout, retry, dan parsing respons mentah

Endpoint yang dipakai:

- `GET /sholat/kabkota/cari/{keyword}`
- `GET /sholat/jadwal/{id}/{YYYY-MM}`

`PrayerApiService` tidak boleh menulis langsung ke file cache.

### 3. `PrayerCacheService`

Tanggung jawab:

- membaca file cache lokal
- menulis file cache lokal
- merge data bulan baru ke file tahun yang sesuai
- memvalidasi struktur cache

`PrayerCacheService` tidak boleh memanggil API.

### 4. `PrayerSyncService`

Tanggung jawab:

- menentukan kapan sync dijalankan
- menentukan range bulan yang harus diambil
- memanggil API per bulan
- menggabungkan hasil ke cache
- mencatat metadata sync terakhir

### 5. `PrayerScheduleProvider`

Tanggung jawab:

- menyediakan jadwal harian ke runtime aplikasi
- membaca dari cache lokal yang sudah dinormalisasi
- tidak bergantung langsung pada API

Ini penting agar UI, FSM, dan countdown tetap stabil walaupun internet putus.

## Prinsip Integrasi

Prinsip yang wajib dipertahankan:

- startup UI tidak boleh menunggu API selesai
- cache lama tidak boleh dihapus hanya karena sync gagal
- cache lokal adalah sumber data utama runtime
- request API dilakukan di background
- perubahan API di masa depan harus cukup diisolasi pada layer adapter/service

## Data yang Didapat dari API

Contoh respons bulanan dari endpoint:

- `GET /sholat/jadwal/{locationId}/2026-04`

Field harian yang tersedia:

- `tanggal`
- `imsak`
- `subuh`
- `terbit`
- `dhuha`
- `dzuhur`
- `ashar`
- `maghrib`
- `isya`

Field ini sudah cukup untuk kebutuhan signage Anda.

## Format Cache Lokal

Cache disarankan tidak menyimpan respons raw API sebagai sumber utama.

Simpan data yang sudah dinormalisasi untuk kebutuhan aplikasi sendiri.

Alasan:

- lebih stabil untuk runtime
- lebih mudah dipakai provider
- lebih mudah dimigrasi jika sumber API berubah
- mengurangi coupling ke format pihak ketiga

### Lokasi Penyimpanan

Sesuai keputusan proyek saat ini, file JSON jadwal sholat disimpan di folder:

- `D:\ProjectMagang\MasjidPunya\solat\resources\js\data`

Supaya struktur tetap rapi, gunakan subfolder khusus di bawah folder tersebut.

Contoh lokasi yang disarankan:

- `D:\ProjectMagang\MasjidPunya\solat\resources\js\data\jadwal-sholat\6cdd60ea0045eb7a6ec44c54d29ed402-2026.json`
- `D:\ProjectMagang\MasjidPunya\solat\resources\js\data\jadwal-sholat\6cdd60ea0045eb7a6ec44c54d29ed402-2027.json`

Atau jika ingin dipisah per lokasi:

- `D:\ProjectMagang\MasjidPunya\solat\resources\js\data\jadwal-sholat\6cdd60ea0045eb7a6ec44c54d29ed402\2026.json`
- `D:\ProjectMagang\MasjidPunya\solat\resources\js\data\jadwal-sholat\6cdd60ea0045eb7a6ec44c54d29ed402\2027.json`

Untuk dokumen ini, pendekatan default yang dipakai adalah:

- `resources/js/data/jadwal-sholat/<locationId>-<year>.json`

Metadata kecil tetap boleh di `Neutralino.storage`.

### Metadata di `Neutralino.storage`

Key yang disarankan:

- `prayer_location_id`
- `prayer_location_name`
- `prayer_location_province`
- `prayer_cache_version`
- `prayer_last_sync_at`
- `prayer_sync_range_start`
- `prayer_sync_range_end`
- `prayer_last_sync_status`
- `prayer_last_sync_error`

### Struktur File Cache Tahunan

Contoh:

```json
{
  "schemaVersion": 1,
  "source": "myquran-v3",
  "sourceBaseUrl": "https://api.myquran.com/v3/",
  "location": {
    "id": "6cdd60ea0045eb7a6ec44c54d29ed402",
    "kabko": "KOTA BOGOR",
    "prov": "JAWA BARAT"
  },
  "year": 2026,
  "updatedAt": "2026-04-02T09:45:00+07:00",
  "days": {
    "2026-04-02": {
      "tanggal": "Kamis, 02/04/2026",
      "times": {
        "imsak": "04:31",
        "subuh": "04:41",
        "terbit": "05:48",
        "dhuha": "06:20",
        "dzuhur": "12:00",
        "ashar": "15:15",
        "maghrib": "18:05",
        "isya": "19:09"
      }
    }
  }
}
```

## Kontrak Data Internal Provider

Provider runtime sebaiknya mengubah cache tahunan menjadi bentuk internal yang dipakai aplikasi saat ini.

Kontrak output harian yang disarankan:

```json
[
  { "name": "Imsak", "time": "04:31" },
  { "name": "Subuh", "time": "04:41" },
  { "name": "Terbit", "time": "05:48" },
  { "name": "Dhuha", "time": "06:20" },
  { "name": "Dzuhur", "time": "12:00" },
  { "name": "Ashar", "time": "15:15" },
  { "name": "Maghrib", "time": "18:05" },
  { "name": "Isya", "time": "19:09" }
]
```

Mapping nama yang disarankan:

- `imsak -> Imsak`
- `subuh -> Subuh`
- `terbit -> Terbit`
- `dhuha -> Dhuha`
- `dzuhur -> Dzuhur`
- `ashar -> Ashar`
- `maghrib -> Maghrib`
- `isya -> Isya`

Catatan:

- provider sample lama di repo saat ini memakai key `MM-DD`
- provider cache API baru harus memakai key penuh `YYYY-MM-DD`

## Flow Setup Lokasi

Flow awal yang disarankan:

1. Operator membuka pengaturan lokasi.
2. Operator memasukkan keyword lokasi, misalnya `bogor`.
3. Aplikasi memanggil `GET /sholat/kabkota/cari/{keyword}`.
4. Aplikasi menampilkan daftar hasil.
5. Operator memilih lokasi yang benar.
6. Aplikasi menyimpan metadata lokasi.
7. Aplikasi menjalankan initial sync.

Contoh hasil pencarian:

- `KAB. BOGOR`
- `KOTA BOGOR`

Karena hasil dapat lebih dari satu, pemilihan operator wajib ada.

## Flow Startup Aplikasi

Flow startup yang disarankan:

1. Load metadata lokasi dari `Neutralino.storage`.
2. Load file cache lokal yang sesuai.
3. Jika cache tersedia, provider langsung aktif dari cache.
4. UI/FSM berjalan normal tanpa menunggu internet.
5. Di background, lakukan cek online.
6. Jika online, jalankan sync incremental.
7. Jika offline, tetap gunakan cache lokal.

Tujuan utama flow ini:

- startup cepat
- UI tidak blank
- internet tidak menjadi dependency untuk menjalankan signage

## Flow Sinkronisasi

### Strategi Range

Jika tanggal saat ini `2026-04-02`, maka range sync yang disarankan:

- `2026-04`
- `2026-05`
- `2026-06`
- `2026-07`
- `2026-08`
- `2026-09`
- `2026-10`
- `2026-11`
- `2026-12`
- `2027-01`
- `2027-02`
- `2027-03`

Total:

- `12` request bulanan

### Strategi Pengambilan

Urutan sync yang disarankan:

1. bulan berjalan
2. sisa bulan dalam tahun berjalan
3. bulan tahun berikutnya sampai genap 12 bulan

### Strategi Merge

Untuk setiap respons bulanan:

1. parse `data.kabko`, `data.prov`, `data.jadwal`
2. tentukan file target berdasarkan tahun
3. jika file belum ada, buat file baru
4. jika file sudah ada, merge berdasarkan key tanggal
5. update `updatedAt`

Aturan merge:

- overwrite tanggal yang sama dengan data terbaru
- jangan hapus tanggal lain yang tidak ikut direspons
- jangan sentuh cache lokasi lain

## Kapan Sinkronisasi Dijalankan

Kebijakan sync yang disarankan:

- saat startup jika online
- saat operator mengganti lokasi
- saat operator menekan tombol `Sync Jadwal`
- saat bulan baru dimulai
- saat `lastSyncAt` lebih lama dari 12 atau 24 jam

Yang tidak disarankan:

- sync setiap menit
- sync setiap jam tanpa alasan
- sync langsung setiap reload UI

## Online Check

Cara aman:

- coba request ke endpoint ringan seperti `GET /health`
- jika gagal, anggap offline
- jangan blok startup karena health check

Catatan:

- health check hanya untuk validasi koneksi ke layanan API
- runtime aplikasi tetap harus mengandalkan cache lokal

## Retry dan Timeout

Kebijakan retry yang disarankan:

- timeout per request: `8-10 detik`
- retry maksimal: `2 kali`
- delay retry: `1 detik` lalu `3 detik`

Jika gagal:

- catat error
- lanjut ke bulan berikutnya
- jangan batalkan seluruh sync hanya karena 1 bulan gagal

## Fallback Policy

Urutan fallback:

1. cache lokal terbaru
2. cache lokal lama meskipun stale
3. sample JSON bawaan aplikasi

Aturan:

- jika sync gagal, cache lama tetap dipakai
- jika file cache rusak, coba file tahun lain jika masih relevan
- jika semua gagal, baru pakai sample internal

## Error Handling

Kasus yang wajib ditangani:

- internet tidak tersedia
- timeout request
- API 404/500/503
- respons `status: false`
- lokasi belum dipilih
- file cache tidak ada
- file cache korup
- sebagian bulan berhasil, sebagian gagal

Perilaku yang diharapkan:

- UI tetap hidup
- countdown tetap jalan dari data yang tersedia
- error hanya dicatat untuk operator/log

## Validasi Data

Sebelum cache disimpan, validasi minimum:

- `status === true`
- `data.id` ada
- `data.kabko` ada
- `data.prov` ada
- `data.jadwal` object
- setiap tanggal memiliki field utama:
  - `subuh`
  - `dzuhur`
  - `ashar`
  - `maghrib`
  - `isya`

Field `imsak`, `terbit`, dan `dhuha` juga sebaiknya disimpan jika ada.

## Kebijakan Ganti Lokasi

Saat operator mengganti lokasi:

1. simpan metadata lokasi baru
2. reset status sync
3. jalankan sync awal untuk lokasi baru
4. jangan hapus cache lokasi lama secara otomatis kecuali operator minta

Alasan:

- aman untuk rollback
- berguna jika operator salah pilih lokasi

## Kebutuhan API Neutralino Saat Implementasi

Saat nanti diimplementasikan, kemungkinan izin API perlu ditambah:

- `filesystem.readFile`
- `filesystem.writeFile`
- `filesystem.createDirectory`
- `filesystem.remove`
- `filesystem.getStats`
- `filesystem.getAbsolutePath`

Kemungkinan tambahan:

- `os.getPath` jika ingin menempatkan cache di lokasi sistem tertentu

## Strategi Versi Cache

Tambahkan `schemaVersion` pada file cache.

Aturan:

- jika `schemaVersion` berubah, provider dapat memigrasi file lama
- jika migrasi gagal, app tetap bisa re-sync dari API

## Milestone Implementasi yang Disarankan

### Fase 1

- tambah konfigurasi metadata lokasi
- tambah service pencarian lokasi

### Fase 2

- buat `PrayerApiService`
- buat `PrayerCacheService`
- uji fetch 1 bulan dan simpan cache

### Fase 3

- buat `PrayerSyncService`
- implement sync 12 bulan ke depan

### Fase 4

- buat provider runtime berbasis cache API
- fallback ke sample JSON lama

### Fase 5

- tambah tombol operator untuk `Pilih Lokasi` dan `Sync Jadwal`
- tampilkan status sync terakhir

### Fase 6

- uji online/offline
- uji cache korup
- uji startup tanpa internet

## Acceptance Criteria

- operator dapat memilih lokasi melalui pencarian
- aplikasi dapat mengambil jadwal 12 bulan ke depan dari API
- hasil sync tersimpan ke JSON lokal
- aplikasi tetap menampilkan jadwal saat offline
- startup tidak bergantung pada internet
- pergantian lokasi tidak merusak cache lokasi lain
- cache lama tetap aman jika sync gagal

## Keputusan Final yang Disarankan

- gunakan API `myQuran v3` sebagai upstream source
- gunakan cache JSON lokal sebagai source of truth runtime
- lakukan sync per bulan, bukan per tahun langsung
- simpan cache per lokasi dan per tahun
- jangan baca API langsung dari UI/runtime utama

## Referensi Uji

Contoh pencarian lokasi:

- `https://api.myquran.com/v3/sholat/kabkota/cari/bogor`

Contoh jadwal bulanan:

- `https://api.myquran.com/v3/sholat/jadwal/6cdd60ea0045eb7a6ec44c54d29ed402/2026-04`

Contoh jadwal hari ini:

- `https://api.myquran.com/v3/sholat/jadwal/6cdd60ea0045eb7a6ec44c54d29ed402/today`

Contoh bulan masa depan:

- `https://api.myquran.com/v3/sholat/jadwal/6cdd60ea0045eb7a6ec44c54d29ed402/2027-01`
