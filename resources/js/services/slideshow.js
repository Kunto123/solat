/**
 * services/slideshow.js
 *
 * Neutralino mode:
 * - baca folder lokal, mount ke route /slides, watcher aktif
 *
 * Web mode:
 * - baca blob gambar dari IndexedDB browser
 * - tidak ada watcher folder OS
 */

import { isNeutralinoRuntime, log } from './platform.js';
import * as browserImageStore from './browserImageStore.js';

const MOUNT_ROUTE = '/slides';
const IMAGE_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'webp']);
const MIN_INTERVAL_MS = 3000;
const DEFAULT_INTERVAL_MS = 8000;
const MORPH_DURATION_MS = 1400;

let _folderPath = null;
let _mountActive = false;
let _images = [];
let _cursor = 0;
let _intervalMs = DEFAULT_INTERVAL_MS;
let _timer = null;
let _watcherId = null;
let _initialized = false;
let _transitioning = false;

let _elActive = null;
let _elStaging = null;
let _elLayer = null;
let _activeSlideEl = null;
let _bufferSlideEl = null;
let _ambientActiveEl = null;
let _ambientStagingEl = null;
let _activeAmbientEl = null;
let _bufferAmbientEl = null;

export async function init(folderPath, intervalMs = DEFAULT_INTERVAL_MS) {
  if (_initialized) await stop();

  _initElements();
  _intervalMs = Math.max(MIN_INTERVAL_MS, intervalMs);
  _folderPath = folderPath ?? null;

  try {
    if (isNeutralinoRuntime) {
      await _initNeutralinoSlideshow();
    } else {
      await _initWebSlideshow();
    }
  } catch (error) {
    _resetSlides();
    _showFallback();
    await log(`Slideshow: error init - ${error?.message ?? error}`, 'ERROR');
    _initialized = true;
  }
}

export async function stop() {
  if (!_initialized) return;

  _clearTimer();

  if (isNeutralinoRuntime) {
    await _stopWatcher();
    await _unmountFolder();
  }

  _resetSlides();
  _images = [];
  _cursor = 0;
  _transitioning = false;
  _initialized = false;
}

export async function changeFolder(folderPath) {
  await init(folderPath, _intervalMs);
}

async function _initNeutralinoSlideshow() {
  if (!_folderPath) {
    _resetSlides();
    _showFallback();
    await log('Slideshow: tidak ada folder - pakai fallback background');
    _initialized = true;
    return;
  }

  await _mountFolder(_folderPath);
  const images = await _scanImages(_folderPath);

  if (images.length === 0) {
    _resetSlides();
    _showFallback();
    await log('Slideshow: folder kosong - pakai fallback background');
    _initialized = true;
    return;
  }

  _images = _shuffle(images.map(name => ({ sourceType: 'mounted', name })));
  _cursor = 0;
  _hideFallback();
  await _startWatcher(_folderPath);
  await log(`Slideshow: init dengan folder ${_folderPath} (${_images.length} gambar)`);

  _initialized = true;
  _showNext();
}

async function _initWebSlideshow() {
  const images = await browserImageStore.loadImages();

  if (images.length === 0) {
    _resetSlides();
    _showFallback();
    await log('Slideshow: mode web belum memiliki gambar tersimpan');
    _initialized = true;
    return;
  }

  _images = _shuffle(images.map(image => ({ ...image, sourceType: 'blob' })));
  _cursor = 0;
  _hideFallback();
  await log(`Slideshow: mode web memuat ${_images.length} gambar dari IndexedDB`);

  _initialized = true;
  _showNext();
}

function _initElements() {
  _elActive = document.getElementById('slide-active');
  _elStaging = document.getElementById('slide-staging');
  _elLayer = document.getElementById('slideshow-layer');
  _ambientActiveEl = document.getElementById('ambient-active');
  _ambientStagingEl = document.getElementById('ambient-staging');

  _activeSlideEl = _elActive;
  _bufferSlideEl = _elStaging;
  _activeAmbientEl = _ambientActiveEl;
  _bufferAmbientEl = _ambientStagingEl;

  _resetSlideElement(_elActive);
  _resetSlideElement(_elStaging);
  _resetAmbientElement(_ambientActiveEl);
  _resetAmbientElement(_ambientStagingEl);
}

function _resetSlides() {
  _resetSlideElement(_elActive);
  _resetSlideElement(_elStaging);
  _resetAmbientElement(_ambientActiveEl);
  _resetAmbientElement(_ambientStagingEl);
  _activeSlideEl = _elActive;
  _bufferSlideEl = _elStaging;
  _activeAmbientEl = _ambientActiveEl;
  _bufferAmbientEl = _ambientStagingEl;
}

function _resetSlideElement(element) {
  if (!element) return;

  if (element.dataset.objectUrl) {
    URL.revokeObjectURL(element.dataset.objectUrl);
    delete element.dataset.objectUrl;
  }

  element.src = '';
  element.classList.remove('is-active', 'is-entering', 'is-exiting');
  element.onload = null;
  element.onerror = null;
}

function _resetAmbientElement(element) {
  if (!element) return;

  if (element.dataset.objectUrl) {
    URL.revokeObjectURL(element.dataset.objectUrl);
    delete element.dataset.objectUrl;
  }

  element.style.backgroundImage = '';
  element.classList.remove('is-active', 'is-entering', 'is-exiting');
}

function _showFallback() {
  if (_elLayer) _elLayer.classList.remove('has-images');
}

function _hideFallback() {
  if (_elLayer) _elLayer.classList.add('has-images');
}

function _showNext() {
  if (!_initialized || _transitioning || _images.length === 0 || !_bufferSlideEl) return;

  const imageRef = _images[_cursor];
  _cursor = (_cursor + 1) % _images.length;

  if (_cursor === 0) {
    _images = _shuffle(_images);
  }

  _preloadAndMorph(imageRef);
}

function _preloadAndMorph(imageRef) {
  const incoming = _bufferSlideEl;
  if (!incoming) return;

  _transitioning = true;
  _prepareIncomingSlide(incoming, imageRef);

  const onLoad = async () => {
    cleanup();

    try {
      if (typeof incoming.decode === 'function') {
        await incoming.decode();
      }
    } catch (_) {}

    _startMorph(incoming, imageRef);
  };

  const onError = () => {
    cleanup();
    _resetSlideElement(incoming);
    _transitioning = false;
    log(`Slideshow: gagal load ${_describeImage(imageRef)}`, 'WARNING').catch(() => {});
    _scheduleNext();
  };

  function cleanup() {
    incoming.removeEventListener('load', onLoad);
    incoming.removeEventListener('error', onError);
  }

  incoming.addEventListener('load', onLoad);
  incoming.addEventListener('error', onError);
}

function _prepareIncomingSlide(element, imageRef) {
  _resetSlideElement(element);
  element.classList.add('is-entering');

  const source = _resolveImageSource(imageRef);
  if (source.revoke) {
    element.dataset.objectUrl = source.url;
  }
  element.src = source.url;
}

function _startMorph(incoming, imageRef) {
  const outgoing = _activeSlideEl && _activeSlideEl !== incoming ? _activeSlideEl : null;
  _swapAmbient(imageRef);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      incoming.classList.remove('is-entering');
      incoming.classList.add('is-active');

      if (outgoing?.src) {
        outgoing.classList.remove('is-active');
        outgoing.classList.add('is-exiting');
      }

      setTimeout(() => {
        if (outgoing) {
          _resetSlideElement(outgoing);
        }

        _activeSlideEl = incoming;
        _bufferSlideEl = incoming === _elActive ? _elStaging : _elActive;
        _transitioning = false;
        _scheduleNext();
      }, MORPH_DURATION_MS);
    });
  });
}

function _swapAmbient(imageRef) {
  const incoming = _bufferAmbientEl;
  if (!incoming) return;

  _prepareAmbientLayer(incoming, imageRef);

  const outgoing = _activeAmbientEl && _activeAmbientEl !== incoming ? _activeAmbientEl : null;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      incoming.classList.remove('is-entering');
      incoming.classList.add('is-active');

      if (outgoing) {
        outgoing.classList.remove('is-active');
        outgoing.classList.add('is-exiting');
      }

      setTimeout(() => {
        if (outgoing) {
          _resetAmbientElement(outgoing);
        }

        _activeAmbientEl = incoming;
        _bufferAmbientEl = incoming === _ambientActiveEl ? _ambientStagingEl : _ambientActiveEl;
      }, MORPH_DURATION_MS);
    });
  });
}

function _scheduleNext() {
  _clearTimer();
  _timer = setTimeout(() => _showNext(), _intervalMs);
}

function _clearTimer() {
  if (_timer === null) return;
  clearTimeout(_timer);
  _timer = null;
}

function _resolveImageSource(imageRef) {
  if (imageRef?.sourceType === 'blob') {
    return {
      url: URL.createObjectURL(imageRef.blob),
      revoke: true,
    };
  }

  return {
    url: `${MOUNT_ROUTE}/${encodeURIComponent(imageRef?.name ?? '')}`,
    revoke: false,
  };
}

function _prepareAmbientLayer(element, imageRef) {
  _resetAmbientElement(element);
  element.classList.add('is-entering');

  const source = _resolveAmbientSource(imageRef);
  if (source.revoke) {
    element.dataset.objectUrl = source.url;
  }
  element.style.backgroundImage = `url("${source.url}")`;
}

function _resolveAmbientSource(imageRef) {
  if (imageRef?.sourceType === 'blob') {
    return {
      url: URL.createObjectURL(imageRef.blob),
      revoke: true,
    };
  }

  return {
    url: `${MOUNT_ROUTE}/${encodeURIComponent(imageRef?.name ?? '')}`,
    revoke: false,
  };
}

function _describeImage(imageRef) {
  return imageRef?.name ?? 'unknown-image';
}

async function _scanImages(folderPath) {
  const entries = await Neutralino.filesystem.readDirectory(folderPath);

  return entries
    .filter(entry => entry.type === 'FILE')
    .map(entry => entry.entry)
    .filter(name => IMAGE_EXTENSIONS.has(name.split('.').pop()?.toLowerCase() ?? ''));
}

async function _mountFolder(folderPath) {
  try {
    const mounts = await Neutralino.server.getMounts();
    const existing = mounts.find(mount => mount.route === MOUNT_ROUTE);
    if (existing) await Neutralino.server.unmount(MOUNT_ROUTE);
  } catch (_) {}

  await Neutralino.server.mount(MOUNT_ROUTE, folderPath);
  _mountActive = true;
}

async function _unmountFolder() {
  if (!_mountActive) return;

  try {
    await Neutralino.server.unmount(MOUNT_ROUTE);
  } catch (_) {}

  _mountActive = false;
}

async function _startWatcher(folderPath) {
  try {
    const id = await Neutralino.filesystem.createWatcher(folderPath);
    _watcherId = id;

    Neutralino.events.on('watchFile', async event => {
      if (event.detail?.id !== _watcherId) return;

      try {
        const images = await _scanImages(folderPath);
        if (images.length === 0) {
          _showFallback();
          _clearTimer();
          _images = [];
          _resetSlides();
          return;
        }

        _images = _shuffle(images.map(name => ({ sourceType: 'mounted', name })));
        _cursor = 0;
        _hideFallback();

        if (!_timer && !_transitioning) {
          _scheduleNext();
        }
      } catch (_) {}
    });
  } catch (error) {
    await log(`Slideshow: watcher tidak dapat dibuat - ${error?.message ?? error}`, 'WARNING');
  }
}

async function _stopWatcher() {
  if (_watcherId === null) return;

  try {
    await Neutralino.filesystem.removeWatcher(_watcherId);
  } catch (_) {}

  _watcherId = null;
}

function _shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}
