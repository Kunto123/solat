/**
 * core/store.js — Reactive state container
 * Single source of truth untuk seluruh state aplikasi.
 * Update DOM hanya dipicu jika nilai benar-benar berubah.
 */

/** @type {AppState} */
const _state = {
  fsmState: 'BOOT',
  now: null,           // Date | null — diupdate setiap detik oleh clock service
  dailySchedule: [],
  currentPrayer: null, // { name: string, time: Date } | null
  nextPrayer: null,    // { name: string, time: Date } | null
  iqomahRemainingMs: 0,
  activeSideMessage: '',
  scheduleSource: 'uninitialized',
  scheduleYearsLabel: '',
  scheduleLocationLabel: '',
  scheduleHasCacheForDate: false,
  settings: {},        // diisi oleh settings service saat load
};

/** @type {Map<symbol, { keys: string[], handler: Function }>} */
const _listeners = new Map();

/** Kembalikan salinan state saat ini (shallow copy). */
export function getState() {
  return Object.assign({}, _state);
}

/**
 * Update state dan notifikasi subscriber yang terpengaruh.
 * Untuk nilai primitif: perbandingan ===
 * Untuk Date: perbandingan getTime()
 * Untuk PrayerEntry objects: perbandingan berdasarkan name + time.getTime()
 * @param {Partial<AppState>} patch
 */
export function setState(patch) {
  const changed = [];
  for (const key of Object.keys(patch)) {
    if (!_isEqual(_state[key], patch[key])) {
      _state[key] = patch[key];
      changed.push(key);
    }
  }
  if (changed.length > 0) {
    _notify(changed);
  }
}

/** Perbandingan stabil untuk nilai store. */
function _isEqual(a, b) {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((item, index) => _isEqual(item, b[index]));
  }
  // PrayerEntry: { name, time }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    if ('name' in a && 'time' in a) {
      return a.name === b.name && a.time?.getTime() === b.time?.getTime();
    }
  }
  return false;
}

/**
 * Subscribe ke perubahan key tertentu.
 * @param {string | string[]} keys  — key yang ingin diawasi
 * @param {(state: AppState) => void} handler
 * @returns {() => void} — fungsi unsubscribe
 */
export function subscribe(keys, handler) {
  const id = Symbol();
  _listeners.set(id, {
    keys: Array.isArray(keys) ? keys : [keys],
    handler,
  });
  return () => _listeners.delete(id);
}

function _notify(changedKeys) {
  const snapshot = getState();
  for (const { keys, handler } of _listeners.values()) {
    if (keys.some(k => changedKeys.includes(k))) {
      handler(snapshot);
    }
  }
}
