/**
 * scripts/patch-prod.js
 * Patches neutralino.config.json ke nilai production sebelum `neu build`.
 * Backup dev config disimpan ke neutralino.config.dev.json.
 *
 * Usage:
 *   node scripts/patch-prod.js
 *
 * Setelah neu build selesai, jalankan:
 *   node scripts/restore-dev.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'neutralino.config.json');
const DEV_BACKUP_PATH = path.join(ROOT, 'neutralino.config.dev.json');

const PROD_WINDOW_PATCH = {
  fullScreen: true,
  borderless: true,
  enableInspector: false,
  resizable: false,
  exitProcessOnClose: true,
  useSavedState: false,
  useLogicalPixels: true,
  // width/height tidak relevan saat fullScreen:true, tapi tetap disertakan
  width: 1920,
  height: 1080,
  minWidth: 1280,
  minHeight: 720,
};

function main() {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('[patch-prod] ERROR: neutralino.config.json tidak ditemukan.');
    process.exit(1);
  }

  if (fs.existsSync(DEV_BACKUP_PATH)) {
    console.warn('[patch-prod] WARNING: neutralino.config.dev.json sudah ada.');
    console.warn('  Kemungkinan patch-prod sudah dijalankan sebelumnya.');
    console.warn('  Jalankan restore-dev.js terlebih dahulu jika ingin memulai ulang.');
    process.exit(1);
  }

  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  const config = JSON.parse(raw);

  // Simpan backup
  fs.writeFileSync(DEV_BACKUP_PATH, raw, 'utf8');
  console.log('[patch-prod] Backup disimpan ke neutralino.config.dev.json');

  // Patch window mode
  config.modes = config.modes || {};
  config.modes.window = Object.assign({}, config.modes.window, PROD_WINDOW_PATCH);

  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  console.log('[patch-prod] neutralino.config.json berhasil di-patch ke production.');
  console.log('[patch-prod] Sekarang jalankan: neu build');
  console.log('[patch-prod] Setelah build selesai: node scripts/restore-dev.js');
}

main();
