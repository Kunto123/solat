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
import {
  buildBundledImageUrl,
  isVideoFileName,
  listNeutralinoFolderImages,
  loadBundledManifestImages,
  normalizeSlideshowFolder,
  resolveNeutralinoFolderPath,
  WEB_SLIDESHOW_SOURCE,
} from './slideshowLibrary.js';

const MOUNT_ROUTE = '/slides';
const MIN_INTERVAL_MS = 3000;
const DEFAULT_INTERVAL_MS = 8000;
const MORPH_DURATION_MS = 1400;
const WEB_MANIFEST_REFRESH_MS = 15000;

let _folderPath = null;
let _mountActive = false;
let _images = [];
let _cursor = 0;
let _intervalMs = DEFAULT_INTERVAL_MS;
let _timer = null;
let _watcherId = null;
let _webManifestTimer = null;
let _webManifestSignature = '';
let _initialized = false;
let _transitioning = false;
let _videoEnded = false;

// Per-slot: each slot has an img and a vid element
// Slot A = { img: #slide-active, vid: #slide-vid-active }
// Slot B = { img: #slide-staging, vid: #slide-vid-staging }
let _slotA = null;
let _slotB = null;
let _activeSlot = null;
let _bufferSlot = null;
let _activeSlideEl = null;  // the img or vid element currently visible
let _elLayer = null;
let _ambientActiveEl = null;
let _ambientStagingEl = null;
let _activeAmbientEl = null;
let _bufferAmbientEl = null;

export async function init(folderPath, intervalMs = DEFAULT_INTERVAL_MS) {
  if (_initialized) await stop();

  _initElements();
  _intervalMs = Math.max(MIN_INTERVAL_MS, intervalMs);
  _folderPath = normalizeSlideshowFolder(folderPath);

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
  } else {
    _stopWebManifestPolling();
  }

  _resetSlides();
  _images = [];
  _cursor = 0;
  _transitioning = false;
  _videoEnded = false;
  _initialized = false;
}

export async function changeFolder(folderPath) {
  await init(folderPath, _intervalMs);
}

async function _initNeutralinoSlideshow() {
  const activeFolderPath = await resolveNeutralinoFolderPath(_folderPath);

  await _mountFolder(activeFolderPath);
  const images = await _scanImages(activeFolderPath);

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
  await _startWatcher(activeFolderPath);
  await log(`Slideshow: init dengan folder ${activeFolderPath} (${_images.length} gambar)`);

  _initialized = true;
  _showNext();
}

async function _initWebSlideshow() {
  if (_folderPath === WEB_SLIDESHOW_SOURCE) {
    const browserImages = await browserImageStore.loadImages();

    if (browserImages.length > 0) {
      _images = _shuffle(browserImages.map(image => ({ ...image, sourceType: 'blob' })));
      _cursor = 0;
      _hideFallback();
      await log(`Slideshow: mode web memuat ${_images.length} gambar dari IndexedDB`);

      _initialized = true;
      _showNext();
      return;
    }

    await log('Slideshow: mode web belum memiliki gambar tersimpan, lanjut cek aset bawaan', 'WARNING');
  }

  const assetImages = await _loadBundledImages();

  if (assetImages.length === 0) {
    _resetSlides();
    _showFallback();
    await log('Slideshow: mode web tidak menemukan gambar slideshow, pakai fallback background');
    _initialized = true;
    return;
  }

  _images = _shuffle(assetImages);
  _cursor = 0;
  _webManifestSignature = _serializeImageNames(assetImages);
  _hideFallback();
  await log(`Slideshow: mode web memuat ${_images.length} gambar aset bawaan`);

  _initialized = true;
  _startWebManifestPolling();
  _showNext();
}

function _initElements() {
  _slotA = {
    img: document.getElementById('slide-active'),
    vid: document.getElementById('slide-vid-active'),
    blur: document.getElementById('slide-blur-a'),
  };
  _slotB = {
    img: document.getElementById('slide-staging'),
    vid: document.getElementById('slide-vid-staging'),
    blur: document.getElementById('slide-blur-b'),
  };
  _elLayer = document.getElementById('slideshow-layer');
  _ambientActiveEl = document.getElementById('ambient-active');
  _ambientStagingEl = document.getElementById('ambient-staging');

  _activeSlot = _slotA;
  _bufferSlot = _slotB;
  _activeSlideEl = null;
  _activeAmbientEl = _ambientActiveEl;
  _bufferAmbientEl = _ambientStagingEl;

  _resetSlideElement(_slotA.img);
  _resetSlideElement(_slotA.vid);
  _resetBlurFill(_slotA.blur);
  _resetSlideElement(_slotB.img);
  _resetSlideElement(_slotB.vid);
  _resetBlurFill(_slotB.blur);
  _resetAmbientElement(_ambientActiveEl);
  _resetAmbientElement(_ambientStagingEl);
}

function _resetSlides() {
  if (_slotA) {
    _resetSlideElement(_slotA.img);
    _resetSlideElement(_slotA.vid);
    _resetBlurFill(_slotA.blur);
  }
  if (_slotB) {
    _resetSlideElement(_slotB.img);
    _resetSlideElement(_slotB.vid);
    _resetBlurFill(_slotB.blur);
  }
  _resetAmbientElement(_ambientActiveEl);
  _resetAmbientElement(_ambientStagingEl);
  _activeSlot = _slotA;
  _bufferSlot = _slotB;
  _activeSlideEl = null;
  _activeAmbientEl = _ambientActiveEl;
  _bufferAmbientEl = _ambientStagingEl;
}

function _resetSlideElement(element) {
  if (!element) return;

  if (element.dataset.objectUrl) {
    URL.revokeObjectURL(element.dataset.objectUrl);
    delete element.dataset.objectUrl;
  }

  if (element.tagName === 'VIDEO') {
    element.pause();
    element.removeAttribute('src');
    element.load();
  } else {
    element.src = '';
  }

  element.classList.remove('is-active', 'is-entering', 'is-exiting');
  element.onload = null;
  element.onerror = null;
}

function _resetBlurFill(element) {
  if (!element) return;
  element.style.backgroundImage = '';
  element.classList.remove('is-active', 'is-entering', 'is-exiting');
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
  if (!_initialized || _transitioning || _images.length === 0 || !_bufferSlot) return;

  const imageRef = _images[_cursor];
  _cursor = (_cursor + 1) % _images.length;

  if (_cursor === 0) {
    _images = _shuffle(_images);
  }

  _preloadAndMorph(imageRef);
}

function _preloadAndMorph(imageRef) {
  const slot = _bufferSlot;
  if (!slot) return;

  _transitioning = true;
  _videoEnded = false;

  const isVideo = isVideoFileName(imageRef?.name ?? '');
  const incoming = isVideo ? slot.vid : slot.img;
  const unused = isVideo ? slot.img : slot.vid;
  const blurFill = slot.blur ?? null;

  _resetSlideElement(unused);
  _prepareIncomingSlide(incoming, imageRef, isVideo, blurFill);

  const onLoad = async () => {
    cleanup();
    if (!isVideo) {
      try {
        if (typeof incoming.decode === 'function') {
          await incoming.decode();
        }
      } catch (_) {}
    }
    _startMorph(incoming, imageRef, isVideo);
  };

  const onError = () => {
    cleanup();
    _resetSlideElement(incoming);
    _transitioning = false;
    log(`Slideshow: gagal load ${_describeImage(imageRef)}`, 'WARNING').catch(() => {});
    _scheduleNext();
  };

  function cleanup() {
    if (isVideo) {
      incoming.removeEventListener('loadeddata', onLoad);
    } else {
      incoming.removeEventListener('load', onLoad);
    }
    incoming.removeEventListener('error', onError);
  }

  if (isVideo) {
    incoming.addEventListener('loadeddata', onLoad);
    incoming.addEventListener('error', onError);
  } else {
    incoming.addEventListener('load', onLoad);
    incoming.addEventListener('error', onError);
  }
}

function _prepareIncomingSlide(element, imageRef, isVideo = false, blurFill = null) {
  _resetSlideElement(element);
  element.classList.add('is-entering');

  const source = _resolveImageSource(imageRef);
  if (source.revoke) {
    element.dataset.objectUrl = source.url;
  }
  element.src = source.url;
  if (isVideo) {
    element.load();
  }

  if (blurFill && !isVideo) {
    _resetBlurFill(blurFill);
    blurFill.classList.add('is-entering');
    blurFill.style.backgroundImage = `url("${source.url}")`;
  } else if (blurFill) {
    _resetBlurFill(blurFill);
  }
}

function _startMorph(incoming, imageRef, isVideo = false) {
  const outgoing = _activeSlideEl && _activeSlideEl !== incoming ? _activeSlideEl : null;
  const incomingSlot = _bufferSlot;
  const outgoingSlot = _activeSlot !== incomingSlot ? _activeSlot : null;
  _swapAmbient(imageRef, isVideo);

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      incoming.classList.remove('is-entering');
      incoming.classList.add('is-active');

      // Activate blur fill for incoming slot (images only)
      if (incomingSlot?.blur && !isVideo) {
        incomingSlot.blur.classList.remove('is-entering');
        incomingSlot.blur.classList.add('is-active');
      }

      if (isVideo) {
        incoming.play().catch(() => {});
        incoming.addEventListener('ended', () => {
          if (_transitioning) {
            _videoEnded = true;
          } else {
            _showNext();
          }
        }, { once: true });
      }

      if (outgoing) {
        outgoing.classList.remove('is-active');
        outgoing.classList.add('is-exiting');
        if (outgoing.tagName === 'VIDEO') {
          outgoing.pause();
        }
      }

      if (outgoingSlot?.blur) {
        outgoingSlot.blur.classList.remove('is-active');
        outgoingSlot.blur.classList.add('is-exiting');
      }

      setTimeout(() => {
        if (outgoing) {
          _resetSlideElement(outgoing);
        }
        if (outgoingSlot?.blur) {
          _resetBlurFill(outgoingSlot.blur);
        }

        _activeSlideEl = incoming;
        _activeSlot = _bufferSlot;
        _bufferSlot = _bufferSlot === _slotA ? _slotB : _slotA;
        _transitioning = false;

        if (!isVideo) {
          _scheduleNext();
        } else if (_videoEnded) {
          _videoEnded = false;
          _showNext();
        }
      }, MORPH_DURATION_MS);
    });
  });
}

function _swapAmbient(imageRef, isVideo = false) {
  if (isVideo) return; // CSS background-image doesn't support video
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

  if (imageRef?.sourceType === 'asset') {
    return {
      url: imageRef.url ?? buildBundledImageUrl(imageRef?.name ?? ''),
      revoke: false,
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

  if (imageRef?.sourceType === 'asset') {
    return {
      url: imageRef.url ?? buildBundledImageUrl(imageRef?.name ?? ''),
      revoke: false,
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
  return listNeutralinoFolderImages(folderPath);
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

function _startWebManifestPolling() {
  _stopWebManifestPolling();
  _webManifestTimer = setInterval(() => {
    _refreshWebManifest().catch(() => {});
  }, WEB_MANIFEST_REFRESH_MS);
}

function _stopWebManifestPolling() {
  if (_webManifestTimer === null) return;
  clearInterval(_webManifestTimer);
  _webManifestTimer = null;
}

async function _loadBundledImages() {
  try {
    const fileNames = await loadBundledManifestImages();
    return fileNames.map(fileName => ({
      sourceType: 'asset',
      name: fileName,
      url: buildBundledImageUrl(fileName),
    }));
  } catch (error) {
    await log(`Slideshow: manifest aset gagal dimuat - ${error?.message ?? error}`, 'WARNING');
    return [];
  }
}

async function _refreshWebManifest() {
  if (!_initialized || isNeutralinoRuntime || _folderPath === WEB_SLIDESHOW_SOURCE) {
    return;
  }

  const nextImages = await _loadBundledImages();
  const nextSignature = _serializeImageNames(nextImages);
  if (nextSignature === _webManifestSignature) {
    return;
  }

  _webManifestSignature = nextSignature;

  if (nextImages.length === 0) {
    _clearTimer();
    _images = [];
    _cursor = 0;
    _resetSlides();
    _showFallback();
    await log('Slideshow: manifest web kosong, pakai fallback background', 'WARNING');
    return;
  }

  _images = _shuffle(nextImages);
  _cursor = 0;
  _hideFallback();
  _clearTimer();

  if (!_transitioning) {
    _showNext();
    return;
  }

  _scheduleNext();
}

function _serializeImageNames(images) {
  return JSON.stringify(
    (images ?? []).map(image => String(image?.name ?? ''))
  );
}

function _shuffle(items) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[randomIndex]] = [shuffled[randomIndex], shuffled[index]];
  }
  return shuffled;
}
