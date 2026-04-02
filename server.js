const express = require('express');
const multer = require('multer');
const fs = require('fs/promises');
const path = require('path');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const ROOT_DIR = __dirname;
const RESOURCES_DIR = path.join(ROOT_DIR, 'resources');
const SLIDESHOW_DIR = path.join(RESOURCES_DIR, 'assets', 'slideshow');
const MANIFEST_PATH = path.join(SLIDESHOW_DIR, 'manifest.json');
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_UPLOAD_FILES = 50;
const MAX_UPLOAD_FILE_SIZE_BYTES = 20 * 1024 * 1024;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: MAX_UPLOAD_FILES,
    fileSize: MAX_UPLOAD_FILE_SIZE_BYTES,
  },
  fileFilter: (_, file, callback) => {
    const extension = path.extname(String(file.originalname || '')).toLowerCase();
    const mimeType = String(file.mimetype || '').toLowerCase();
    const accepted = mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extension);

    if (!accepted) {
      callback(new Error(`Format file tidak didukung: ${file.originalname || 'unknown-file'}`));
      return;
    }

    callback(null, true);
  },
});

app.use('/api', (req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

app.get('/api/slideshow/images', async (_req, res, next) => {
  try {
    const payload = await syncSlideshowManifest();
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post('/api/slideshow/upload', upload.array('images', MAX_UPLOAD_FILES), async (req, res, next) => {
  try {
    await ensureSlideshowDirectory();

    const files = Array.isArray(req.files) ? req.files : [];
    if (files.length === 0) {
      res.status(400).json({
        error: 'Tidak ada file gambar yang diterima',
      });
      return;
    }

    const uploaded = [];
    for (const file of files) {
      const safeName = sanitizeFileName(file.originalname);
      const targetName = await getUniqueFileName(safeName);
      const targetPath = path.join(SLIDESHOW_DIR, targetName);

      await fs.writeFile(targetPath, file.buffer);
      uploaded.push(targetName);
    }

    const payload = await syncSlideshowManifest();
    res.status(201).json({
      uploaded,
      images: payload.images,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/assets/slideshow/manifest.json', async (_req, res, next) => {
  try {
    res.setHeader('Cache-Control', 'no-store');
    const payload = await syncSlideshowManifest();
    res.json(payload);
  } catch (error) {
    next(error);
  }
});

app.use(express.static(RESOURCES_DIR, {
  index: 'index.html',
}));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) {
    next();
    return;
  }

  res.sendFile(path.join(RESOURCES_DIR, 'index.html'));
});

app.use((error, _req, res, _next) => {
  const status = Number(error?.statusCode || error?.status || 500);
  res.status(status).json({
    error: error?.message || 'Terjadi kesalahan pada server',
  });
});

start().catch(error => {
  console.error('[server] gagal start:', error);
  process.exitCode = 1;
});

async function start() {
  await ensureSlideshowDirectory();
  await syncSlideshowManifest();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Masjid signage aktif di http://0.0.0.0:${PORT}`);
    console.log(`[server] Folder slideshow: ${SLIDESHOW_DIR}`);
  });
}

async function ensureSlideshowDirectory() {
  await fs.mkdir(SLIDESHOW_DIR, { recursive: true });
}

async function syncSlideshowManifest() {
  await ensureSlideshowDirectory();
  const images = await listSlideshowImages();

  const payload = {
    generatedAt: new Date().toISOString(),
    images,
  };

  await fs.writeFile(MANIFEST_PATH, JSON.stringify(payload, null, 2));
  return payload;
}

async function listSlideshowImages() {
  const entries = await fs.readdir(SLIDESHOW_DIR, { withFileTypes: true });

  return entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(fileName => IMAGE_EXTENSIONS.has(path.extname(fileName).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: 'base',
    }));
}

function sanitizeFileName(fileName) {
  const parsed = path.parse(String(fileName || ''));
  const baseName = `${parsed.name}${parsed.ext}`.trim();

  const safeName = baseName
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (safeName) {
    return safeName;
  }

  return `slideshow-${Date.now()}.jpg`;
}

async function getUniqueFileName(preferredName) {
  const extension = path.extname(preferredName);
  const stem = extension ? preferredName.slice(0, -extension.length) : preferredName;

  let attempt = 0;
  while (attempt < 500) {
    const candidate = attempt === 0
      ? preferredName
      : `${stem}-${attempt + 1}${extension}`;

    try {
      await fs.access(path.join(SLIDESHOW_DIR, candidate));
      attempt += 1;
    } catch (_) {
      return candidate;
    }
  }

  return `${stem}-${Date.now()}${extension}`;
}
