/**
 * services/platform.js
 *
 * Runtime adapter agar aplikasi bisa jalan di Neutralino maupun browser biasa.
 */

export const isNeutralinoRuntime = Boolean(
  typeof window !== 'undefined' &&
  window.Neutralino &&
  typeof window.Neutralino.init === 'function' &&
  typeof window.NL_PORT !== 'undefined' &&
  typeof window.NL_TOKEN !== 'undefined'
);

export const isWebRuntime = !isNeutralinoRuntime;

export function initRuntime() {
  if (isNeutralinoRuntime) {
    Neutralino.init();
  }
}

export function onReady(handler) {
  if (isNeutralinoRuntime) {
    Neutralino.events.on('ready', handler);
    return;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => handler(), { once: true });
  } else {
    queueMicrotask(() => handler());
  }
}

export function onEvent(name, handler) {
  if (isNeutralinoRuntime) {
    Neutralino.events.on(name, handler);
    return;
  }

  window.addEventListener(name, event => {
    handler({ detail: event.detail });
  });
}

export function onWindowClose(handler) {
  if (isNeutralinoRuntime) {
    Neutralino.events.on('windowClose', handler);
    return;
  }

  window.addEventListener('beforeunload', handler);
}

export async function storageGet(key) {
  if (isNeutralinoRuntime) {
    return Neutralino.storage.getData(key);
  }

  const value = window.localStorage.getItem(key);
  if (value === null) {
    throw new Error(`Storage key tidak ditemukan: ${key}`);
  }
  return value;
}

export async function storageSet(key, value) {
  if (isNeutralinoRuntime) {
    return Neutralino.storage.setData(key, value);
  }

  window.localStorage.setItem(key, value);
}

export async function storageRemove(key) {
  if (isNeutralinoRuntime) {
    return Neutralino.storage.removeData(key);
  }

  window.localStorage.removeItem(key);
}

export async function log(message, level = 'INFO') {
  if (isNeutralinoRuntime) {
    return Neutralino.debug.log(message, level).catch(() => {});
  }

  const method = level === 'ERROR'
    ? 'error'
    : level === 'WARNING'
      ? 'warn'
      : 'log';
  console[method](`[${level}] ${message}`);
}

export async function showMessageBox(title, content, choice = 'OK', icon = 'INFO') {
  if (isNeutralinoRuntime) {
    return Neutralino.os.showMessageBox(title, content, choice, icon);
  }

  window.alert(`${title}\n\n${content}`);
  return 'OK';
}

export async function requestFullscreen() {
  if (isNeutralinoRuntime) {
    return Neutralino.window.setFullScreen();
  }

  if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
    await document.documentElement.requestFullscreen();
  }
}

export async function exitFullscreen() {
  if (isNeutralinoRuntime) {
    return Neutralino.window.exitFullScreen();
  }

  if (document.fullscreenElement && document.exitFullscreen) {
    await document.exitFullscreen();
  }
}

export async function focusWindow() {
  if (isNeutralinoRuntime) {
    await Neutralino.window.focus();
    await Neutralino.window.show();
    return;
  }

  window.focus();
}

export async function broadcast(event, data = {}) {
  if (isNeutralinoRuntime) {
    return Neutralino.app.broadcast({ event, data });
  }

  window.dispatchEvent(new CustomEvent(event, { detail: data }));
}

export async function exitApp() {
  if (isNeutralinoRuntime) {
    return Neutralino.app.exit();
  }
}
