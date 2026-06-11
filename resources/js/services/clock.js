/**
 * services/clock.js — Master tick service
 *
 * Pure timing service. Tidak menulis ke store langsung.
 * Main.js bertanggung jawab atas semua setState via callback onTick.
 *
 * Self-correcting setTimeout: setiap tick dijadwalkan ulang dari waktu aktual
 * sehingga tidak ada drift kumulatif.
 *
 * Menggunakan timeController.now() agar virtual clock (simulasi) bisa disuntikkan.
 * Saat simulasi aktif, tick dipercepat (250ms) agar countdown tidak melompat besar.
 * Tick rate minimum 50ms, maksimal 1000ms (boundary detik).
 */

import { now as timeNow, isSim, getSpeed } from './timeController.js';

let _onTick  = null;
let _timer   = null;
let _running = false;

function _scheduleNext() {
  let interval;
  if (isSim()) {
    // Scale tick rate with speed: faster sim = faster ticks
    // At speed 60, 16ms tick → ~1 detik virtual per tick
    // At speed 1, 250ms tick
    interval = Math.max(50, Math.min(250, Math.round(1000 / getSpeed())));
  } else {
    interval = 1000 - (Date.now() % 1000);
  }
  _timer = setTimeout(_tick, interval);
}

function _tick() {
  if (!_running) return;
  const now = timeNow();
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
