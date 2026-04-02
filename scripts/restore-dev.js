/**
 * scripts/restore-dev.js
 * Mengembalikan neutralino.config.json ke versi dev setelah `neu build`.
 *
 * Usage:
 *   node scripts/restore-dev.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CONFIG_PATH = path.join(ROOT, 'neutralino.config.json');
const DEV_BACKUP_PATH = path.join(ROOT, 'neutralino.config.dev.json');

function main() {
  if (!fs.existsSync(DEV_BACKUP_PATH)) {
    console.error('[restore-dev] ERROR: neutralino.config.dev.json tidak ditemukan.');
    console.error('  Pastikan patch-prod.js sudah dijalankan sebelumnya.');
    process.exit(1);
  }

  const backup = fs.readFileSync(DEV_BACKUP_PATH, 'utf8');
  fs.writeFileSync(CONFIG_PATH, backup, 'utf8');
  fs.unlinkSync(DEV_BACKUP_PATH);

  console.log('[restore-dev] neutralino.config.json berhasil dikembalikan ke versi dev.');
  console.log('[restore-dev] neutralino.config.dev.json dihapus.');
}

main();
