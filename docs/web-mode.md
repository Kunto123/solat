# Web Mode

## Ringkasan

Aplikasi sekarang bisa dijalankan dalam dua mode:

- Neutralino desktop
- browser web biasa

Mode web memakai fallback browser-native untuk hal yang sebelumnya bergantung
ke Neutralino.

## Perubahan Perilaku di Mode Web

- settings disimpan di `localStorage`
- cache jadwal sholat disimpan di `localStorage`
- gambar slideshow disimpan di `IndexedDB`
- operator memilih gambar slideshow lewat file picker browser
- tidak ada akses folder lokal OS secara langsung
- tidak ada watcher folder OS seperti di Neutralino

## Cara Menjalankan

Serve folder `resources` sebagai static web root.

Contoh:

```powershell
cd D:\ProjectMagang\MasjidPunya\solat\resources
npx serve .
```

Lalu buka URL yang diberikan server, misalnya:

```text
http://localhost:3000
```

## Catatan Android TV

Mode ini lebih cocok untuk Android TV dibanding build Neutralino desktop.

Rekomendasi:

- gunakan browser Chromium/WebView modern
- buka URL signage dari server lokal atau hosting internal
- aktifkan fullscreen dari panel operator
- upload gambar slideshow sekali dari browser yang sama agar tersimpan di IndexedDB perangkat

## Batasan

- gambar slideshow yang dipilih di mode web tersimpan per browser/perangkat
- jika cache browser dibersihkan, gambar slideshow dan cache jadwal ikut hilang
- untuk deployment multi layar, tiap browser perlu memilih gambar sendiri kecuali nanti Anda pindahkan slideshow ke sumber URL bersama
