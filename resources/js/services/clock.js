/**
 * services/clock.js — Master tick service
 *
 * Pure timing service. Tidak menulis ke store langsung.
 * Main.js bertanggung jawab atas semua setState via callback onTick.
 *
 * Self-correcting setTimeout: setiap tick dijadwalkan ulang dari Date.now()
 * aktual sehingga tidak ada drift kumulatif.
 */

let _onTick  = null;
let _timer   = null;
let _running = false;

function _scheduleNext() {
  const msToNextSecond = 1000 - (Date.now() % 1000);
  _timer = setTimeout(_tick, msToNextSecond);
}

function _tick() {
  if (!_running) return;
  const now = new Date();
  if (_onTick) _onTick(now);
  _scheduleNext();
}

/**
 * Mulai master tick.
 * @param {(now: Date) => void} onTick — callback dipanggil tepat di boundary detik
 */
export function start(onTick) {
  if (_running) return;
  _running = true;
  _onTick  = onTick ?? null;
  _scheduleNext();
}

/** Hentikan master tick dan bersihkan timer. */
export function stop() {
  _running = false;
  if (_timer !== null) {
    clearTimeout(_timer);
    _timer = null;
  }
  _onTick = null;
}
