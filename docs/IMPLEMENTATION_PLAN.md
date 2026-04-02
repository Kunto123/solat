# Masjid Digital Signage — Implementation Plan

Generated: 2026-04-01  
Neutralinojs version: 6.5.0 (binary + client)  
Stack: Neutralinojs + Vanilla JS/HTML/CSS

---

## Phase 1 Audit Findings

### Current State (Baseline)

| Item | Status |
|------|--------|
| Neutralinojs version | 6.5.0 |
| App ID | `js.neutralino.sample` (default, harus diganti) |
| nativeAllowList | `app.*`, `os.*`, `debug.log` — terlalu sempit untuk kebutuhan, tapi salah arah (tidak ada filesystem, storage, server, window) |
| Window mode | 800×500, resizable, inspector ON — belum signage |
| dataLocation / storageLocation | tidak di-set (default) |
| useLogicalPixels / useSavedState | tidak ada |
| globalVariables | test data saja |
| Frontend | satu file main.js 10 baris, tidak modular |
| Prayer data | tidak ada |
| Slideshow | tidak ada |
| FSM | tidak ada |
| Clock | tidak ada |
| Single-instance guard | tidak ada |

### Config Gaps vs Target

```
MISSING di nativeAllowList:
  - filesystem.readDirectory
  - filesystem.getStats
  - filesystem.getAbsolutePath
  - filesystem.createWatcher
  - filesystem.removeWatcher
  - storage.setData
  - storage.getData
  - storage.getKeys
  - server.mount
  - server.unmount
  - server.getMounts
  - window.setFullScreen
  - window.exitFullScreen
  - window.focus
  - window.setSize
  - window.show

PERLU DIHAPUS / DIKECILKAN:
  - os.* terlalu lebar → ganti ke spesifik yang dibutuhkan saja
  - app.* — pertahankan (dibutuhkan untuk exit, broadcast, getConfig)
  - Mode browser, cloud, chrome — tidak dipakai untuk signage, bisa distrip
  - globalVariables TEST1/TEST2/TEST3 — hapus

WINDOW MODE PRODUCTION TARGET:
  - fullScreen: true
  - borderless: true
  - resizable: false
  - enableInspector: false
  - useSavedState: false
  - useLogicalPixels: true
  - exitProcessOnClose: true (untuk signage)
```

### Application ID

Ganti dari `js.neutralino.sample` ke `id.masjid.signage` (atau sesuai instruksi operator).

---

## Target Architecture

```
solat/
├── neutralino.config.json          (hardened, dev + prod split via env)
├── IMPLEMENTATION_PLAN.md          (dokumen ini)
├── resources/
│   ├── index.html                  (entry point, load modules)
│   ├── styles.css                  (global base styles)
│   ├── icons/
│   │   ├── appIcon.png
│   │   └── trayIcon.png
│   ├── assets/
│   │   └── fallback/               (fallback background images)
│   └── js/
│       ├── neutralino.js           (Neutralino client lib — jangan diubah)
│       ├── main.js                 (bootstrap: init Neutralino, mount app)
│       ├── core/
│       │   ├── store.js            (reactive state container)
│       │   └── fsm.js              (finite state machine: BOOT/NORMAL/AZAN/IQOMAH/POST_IQOMAH/ERROR)
│       ├── services/
│       │   ├── clock.js            (master tick, self-correcting setTimeout)
│       │   ├── prayer.js           (prayer domain logic: current/next/iqomah countdown)
│       │   ├── slideshow.js        (filesystem scan, server.mount, preload, crossfade, watcher)
│       │   └── settings.js         (Neutralino.storage read/write, folder path, preferences)
│       ├── providers/
│       │   └── prayerScheduleLocal.js  (JSON sample provider — swappable)
│       ├── ui/
│       │   └── render.js           (DOM update functions, diff-only updates)
│       └── data/
│           └── schedule-sample.json    (sample prayer schedule for testing)
```

---

## FSM States

```
BOOT → NORMAL
NORMAL → AZAN (saat masuk waktu azan)
AZAN → IQOMAH (setelah countdown iqomah selesai)
IQOMAH → POST_IQOMAH (setelah iqomah selesai)
POST_IQOMAH → NORMAL (setelah cooldown)
ANY → ERROR (jika terjadi kegagalan kritis)
ERROR → BOOT (setelah retry/reload)
```

Transisi berbasis perbandingan timestamp aktual, bukan timer spekulatif.

---

## nativeAllowList Target (Least Privilege)

```json
"nativeAllowList": [
  "app.exit",
  "app.broadcast",
  "app.getConfig",
  "app.restartProcess",
  "os.showFolderDialog",
  "os.showMessageBox",
  "os.getEnv",
  "debug.log",
  "filesystem.readDirectory",
  "filesystem.getStats",
  "filesystem.getAbsolutePath",
  "filesystem.createWatcher",
  "filesystem.removeWatcher",
  "storage.setData",
  "storage.getData",
  "storage.getKeys",
  "server.mount",
  "server.unmount",
  "server.getMounts",
  "window.setFullScreen",
  "window.exitFullScreen",
  "window.focus",
  "window.setSize",
  "window.show",
  "window.setTitle"
]
```

---

## Phase Roadmap

| Phase | Scope | Status |
|-------|-------|--------|
| 1 | Audit repo, buat rencana | DONE |
| 2 | Hardening & refactor neutralino.config.json | TODO |
| 3 | Struktur folder/module frontend + bootstrap | TODO |
| 4 | UI shell signage 16:9 dengan placeholder | TODO |
| 5 | Settings service + persistence | TODO |
| 6 | Prayer service + sample provider + domain logic | TODO |
| 7 | Slideshow service (scan, mount, preload, crossfade, watcher) | TODO |
| 8 | Clock service + master tick + FSM penuh | TODO |
| 9 | Integrasi semua ke renderer/UI | TODO |
| 10 | Operator/maintenance mode | TODO |
| 11 | Error handling + end-to-end verification | TODO |
| 12 | Build/release flow (neu build production) | TODO |

---

## Phase 2 Plan (Next)

### 2a — neutralino.config.json: Dev config

- Ganti `applicationId` ke `id.masjid.signage`
- Update `version` ke `0.1.0`
- Set `dataLocation: "system"` dan `storageLocation: "system"`
- Perluas dan persempit `nativeAllowList` sesuai tabel di atas
- Hapus `globalVariables` test
- Hapus mode `browser`, `cloud`, `chrome` (tidak relevan)
- Window dev: pertahankan resizable+inspector ON, set ukuran ke 1280×720
- Tambah `useLogicalPixels: true`

### 2b — neutralino.config.json: Production overlay

Karena Neutralino tidak mendukung config file terpisah secara native, strategi:
- Buat `neutralino.config.json` dengan nilai dev sebagai base
- Buat script `scripts/build-prod.js` (Node.js minimal) atau `scripts/patch-prod.sh` yang patch config ke production values sebelum `neu build`
- Production patch: `fullScreen: true`, `borderless: true`, `resizable: false`, `enableInspector: false`, `useSavedState: false`, `exitProcessOnClose: true`

### 2c — Single-instance guard

Neutralinojs tidak punya built-in single-instance API. Strategi terbaik tersedia:
- Gunakan `Neutralino.storage.setData / getData` dengan lock key + timestamp
- Saat app start, cek apakah ada lock aktif (timestamp < 10 detik lalu)
- Jika ada, kirim `app.broadcast` event ke instance lama untuk focus, lalu exit sendiri
- Ini "soft" single-instance — tidak 100% bulletproof tapi cukup untuk signage use case

### 2d — favicon.ico

Tambahkan `/resources/favicon.ico` minimal untuk menghilangkan error log yang tidak perlu.

---

## Risiko & Keputusan Arsitektur

| Item | Keputusan | Alasan |
|------|-----------|--------|
| Dev/prod config split | Script patch pre-build | Neutralino tidak support config override native |
| Single-instance | Storage lock + broadcast | Tidak ada API native, ini pendekatan paling clean |
| Prayer data source | JSON local sample dulu | Memungkinkan testing E2E sebelum API final tersedia |
| Slideshow path | server.mount ke folder user | Lebih aman dan efisien dari readBinaryFile+base64 |
| Master tick | self-correcting setTimeout | setInterval bisa drift; RAF hanya untuk visual |

---

## Cara Verifikasi Phase 2 (setelah selesai)

1. Jalankan `./bin/neutralino-win_x64.exe` — window muncul tanpa error
2. Buka DevTools (masih inspector ON di dev) → Console bersih
3. `neutralinojs.log` — tidak ada error kritis selain favicon (jika belum ditambah)
4. Cek bahwa `Neutralino.storage.setData('test', 'value')` berhasil dari console
5. Cek bahwa `Neutralino.filesystem.readDirectory('C:/')` berhasil (membuktikan allowList benar)
6. Cek bahwa `Neutralino.server.getMounts()` berhasil
