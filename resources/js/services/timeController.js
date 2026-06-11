/**
 * services/timeController.js
 *
 * Incremental virtual clock.
 *
 * Real mode:  now() = new Date()
 * Sim mode:   now() = new Date(_virtualMs), where _virtualMs advances by
 *             (realDelta * speed) each tick.
 *
 * Speed changes only affect FUTURE ticks — no time jumps, no rewind.
 */

let _mode = 'real';
let _virtualMs = 0;        // current virtual time in epoch ms
let _lastRealMs = 0;       // Date.now() of the last tick
let _speed = 1;

const MODE_REAL = 'real';
const MODE_SIM = 'sim';

export function now() {
  if (_mode === MODE_REAL) {
    return new Date();
  }

  const realNow = Date.now();
  const realDelta = realNow - _lastRealMs;
  _virtualMs += Math.max(0, realDelta) * _speed;
  _lastRealMs = realNow;

  return new Date(_virtualMs);
}

export function startSim({ startAt, speed = 1 } = {}) {
  const safeSpeed = Math.max(1, Math.min(60, Number(speed) || 1));
  const safeStart = startAt instanceof Date ? startAt.getTime() : Date.now();

  _mode = MODE_SIM;
  _virtualMs = safeStart;
  _lastRealMs = Date.now();
  _speed = safeSpeed;
}

export function setSpeed(n) {
  if (_mode !== MODE_SIM) return;

  // Freeze current virtual time before changing speed
  const realNow = Date.now();
  const realDelta = realNow - _lastRealMs;
  _virtualMs += Math.max(0, realDelta) * _speed;
  _lastRealMs = realNow;

  _speed = Math.max(1, Math.min(60, Number(n) || 1));
}

export function stopSim() {
  _mode = MODE_REAL;
  _virtualMs = 0;
  _lastRealMs = 0;
  _speed = 1;
}

export function isSim() {
  return _mode === MODE_SIM;
}

export function getSpeed() {
  return _speed;
}

export function getMode() {
  return _mode;
}
