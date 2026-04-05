/**
 * services/audioCue.js
 *
 * Cue beep ringan berbasis Web Audio API.
 */

const BEEP_COUNT = 3;
const BEEP_INTERVAL_MS = 420;
const BEEP_DURATION_MS = 170;
const BEEP_FREQUENCY_HZ = 880;
const BEEP_VOLUME = 0.045;
const AZAN_ALARM_PATH = './assets/sound/alarm.mp3';

let _audioContext = null;
let _unlockBound = false;
let _sequenceToken = 0;
let _timers = new Set();
let _unlockHandler = null;
let _alarmAudio = null;

export function init() {
  _bindUnlockListeners();
}

export async function playAttentionCue() {
  const audioContext = await _ensureAudioContext();
  if (!audioContext) return false;

  try {
    if (audioContext.state !== 'running') {
      await audioContext.resume();
    }
  } catch (_) {}

  if (audioContext.state !== 'running') {
    return false;
  }

  const currentToken = ++_sequenceToken;
  _clearTimers();

  for (let index = 0; index < BEEP_COUNT; index += 1) {
    const timerId = window.setTimeout(() => {
      _timers.delete(timerId);
      if (currentToken !== _sequenceToken) return;
      _playSingleBeep(audioContext);
    }, index * BEEP_INTERVAL_MS);

    _timers.add(timerId);
  }

  return true;
}

export function stop() {
  _sequenceToken += 1;
  _clearTimers();
}

export async function playAzanAlarm() {
  try {
    // Resume audio context from user gesture if needed
    const audioContext = await _ensureAudioContext();
    if (audioContext) {
      try {
        if (audioContext.state !== 'running') {
          await audioContext.resume();
        }
      } catch (_) {}
    }

    // Stop any existing alarm
    if (_alarmAudio) {
      _alarmAudio.pause();
      _alarmAudio.currentTime = 0;
    }

    // Create and play alarm audio
    _alarmAudio = new Audio(AZAN_ALARM_PATH);
    _alarmAudio.volume = 1;
    await _alarmAudio.play();

    return true;
  } catch (error) {
    console.error('[audioCue] Failed to play azan alarm:', error);
    return false;
  }
}

async function _ensureAudioContext() {
  if (typeof window === 'undefined') return null;

  const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextCtor) return null;

  if (!_audioContext) {
    _audioContext = new AudioContextCtor();
  }

  return _audioContext;
}

function _bindUnlockListeners() {
  if (_unlockBound || typeof window === 'undefined') return;

  _unlockHandler = () => {
    _resumeFromGesture().catch(() => {});
  };

  for (const eventName of ['pointerdown', 'touchstart', 'keydown']) {
    window.addEventListener(eventName, _unlockHandler, { passive: true });
  }

  _unlockBound = true;
}

async function _resumeFromGesture() {
  const audioContext = await _ensureAudioContext();
  if (!audioContext) {
    _unbindUnlockListeners();
    return;
  }

  try {
    if (audioContext.state !== 'running') {
      await audioContext.resume();
    }
  } catch (_) {
    return;
  }

  if (audioContext.state === 'running') {
    _unbindUnlockListeners();
  }
}

function _unbindUnlockListeners() {
  if (!_unlockBound || !_unlockHandler || typeof window === 'undefined') return;

  for (const eventName of ['pointerdown', 'touchstart', 'keydown']) {
    window.removeEventListener(eventName, _unlockHandler, { passive: true });
  }

  _unlockBound = false;
  _unlockHandler = null;
}

function _clearTimers() {
  for (const timerId of _timers) {
    clearTimeout(timerId);
  }
  _timers.clear();
}

function _playSingleBeep(audioContext) {
  const startAt = audioContext.currentTime + 0.01;
  const stopAt = startAt + (BEEP_DURATION_MS / 1000);
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(BEEP_FREQUENCY_HZ, startAt);

  gainNode.gain.setValueAtTime(0.0001, startAt);
  gainNode.gain.exponentialRampToValueAtTime(BEEP_VOLUME, startAt + 0.02);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, stopAt);

  oscillator.connect(gainNode);
  gainNode.connect(audioContext.destination);

  oscillator.start(startAt);
  oscillator.stop(stopAt + 0.03);
  oscillator.onended = () => {
    oscillator.disconnect();
    gainNode.disconnect();
  };
}
