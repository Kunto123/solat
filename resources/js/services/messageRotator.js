/**
 * services/messageRotator.js
 *
 * Rotator ringan untuk daftar pesan teks.
 */

const MIN_INTERVAL_MS = 3000;
const DEFAULT_INTERVAL_MS = 10000;

let _messages = [''];
let _intervalMs = DEFAULT_INTERVAL_MS;
let _index = 0;
let _timer = null;
let _paused = false;
let _onChange = () => {};

/**
 * Inisialisasi rotator.
 * @param {{ messages?: string[], intervalMs?: number, onChange?: (message: string) => void }} options
 */
export function init(options = {}) {
  _onChange = typeof options.onChange === 'function' ? options.onChange : () => {};
  _paused = false;
  update(
    {
      messages: options.messages,
      intervalMs: options.intervalMs,
    },
    { reset: true }
  );
}

/**
 * Update daftar pesan atau interval.
 * @param {{ messages?: string[], intervalMs?: number }} options
 * @param {{ reset?: boolean }} [behavior]
 */
export function update(options = {}, behavior = {}) {
  const nextMessages = _sanitizeMessages(options.messages);
  _messages = nextMessages.length > 0 ? nextMessages : [''];
  _intervalMs = Math.max(MIN_INTERVAL_MS, Number(options.intervalMs ?? _intervalMs ?? DEFAULT_INTERVAL_MS));

  if (behavior.reset || _index >= _messages.length) {
    _index = 0;
  }

  _emitCurrent();

  if (_paused || _messages.length <= 1) {
    _clearTimer();
    return;
  }

  _scheduleNext();
}

export function start() {
  _paused = false;
  if (_messages.length > 1) {
    _scheduleNext();
  }
}

export function pause() {
  _paused = true;
  _clearTimer();
}

export function resume() {
  if (!_paused) return;
  _paused = false;

  if (_messages.length > 1) {
    _scheduleNext();
  }
}

export function stop() {
  _clearTimer();
  _paused = false;
  _messages = [''];
  _index = 0;
  _onChange = () => {};
}

export function getCurrent() {
  return _messages[_index] ?? '';
}

function _scheduleNext() {
  _clearTimer();
  _timer = setTimeout(() => {
    if (_paused || _messages.length <= 1) return;

    _index = (_index + 1) % _messages.length;
    _emitCurrent();
    _scheduleNext();
  }, _intervalMs);
}

function _emitCurrent() {
  _onChange(getCurrent());
}

function _clearTimer() {
  if (_timer === null) return;
  clearTimeout(_timer);
  _timer = null;
}

function _sanitizeMessages(messages) {
  return Array.isArray(messages)
    ? messages
        .map(message => String(message ?? '').trim())
        .filter(Boolean)
    : [];
}
