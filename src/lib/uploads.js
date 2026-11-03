import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import multer from 'multer';
import { UPLOAD_DIR, PRIVATE_DIR } from '../config.js';

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

function imageFilter(req, file, cb) {
  if (IMAGE_MIME.has(file.mimetype)) cb(null, true);
  else cb(new UploadError('केवल JPG, PNG, WEBP या GIF चित्र ही अपलोड करें।'));
}

function imageOrPdfFilter(req, file, cb) {
  if (IMAGE_MIME.has(file.mimetype) || file.mimetype === 'application/pdf') cb(null, true);
  else cb(new UploadError('केवल JPG, PNG, WEBP, GIF चित्र या PDF फ़ाइल ही अपलोड करें।'));
}

export class UploadError extends Error {}

export const publicUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 2, fields: 120, fieldSize: 1024 * 1024 },
  fileFilter: imageFilter,
});

// PDFs pass the filter here only so meeting scans can be attached; every handler
// still validates the bytes via saveImage() (images only) or saveDocument().
export const adminUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 12 * 1024 * 1024, files: 20, fields: 200, fieldSize: 2 * 1024 * 1024 },
  fileFilter: imageOrPdfFilter,
  defParamCharset: 'utf8',
});

/** Identify an image by its magic bytes; never trust the client-provided MIME type. */
export function detectImageType(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  if (buf.toString('ascii', 0, 4) === 'GIF8') return 'gif';
  return null;
}

/**
 * Persist an uploaded image buffer.
 * Public images return a web path (/uploads/x.jpg); private ones return just the file name.
 */
export function saveImage(buf, { isPrivate = false } = {}) {
  const ext = detectImageType(buf);
  if (!ext) throw new UploadError('फ़ाइल एक मान्य चित्र नहीं है।');
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(isPrivate ? PRIVATE_DIR : UPLOAD_DIR, name), buf);
  return isPrivate ? name : `/uploads/${name}`;
}

/** Persist a private image or PDF (meeting register scans). Returns { file, kind }. */
export function saveDocument(buf) {
  const isPdf = buf && buf.length > 8 && buf.toString('ascii', 0, 5) === '%PDF-';
  const ext = isPdf ? 'pdf' : detectImageType(buf);
  if (!ext) throw new UploadError('फ़ाइल एक मान्य चित्र (JPG/PNG) या PDF नहीं है।');
  const name = `${crypto.randomBytes(16).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(PRIVATE_DIR, name), buf);
  return { file: name, kind: isPdf ? 'pdf' : 'image' };
}

export function saveDataUrlImage(dataUrl, opts) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new UploadError('हस्ताक्षर का प्रारूप अमान्य है।');
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 600 * 1024) throw new UploadError('हस्ताक्षर की फ़ाइल बहुत बड़ी है।');
  return saveImage(buf, opts);
}

export const PRIVATE_NAME_RE = /^[a-f0-9]{32}\.(png|jpg|webp|gif|pdf)$/;

export function privatePath(name) {
  if (!PRIVATE_NAME_RE.test(String(name))) return null;
  return path.join(PRIVATE_DIR, name);
}

/** Best-effort removal of a previously uploaded file. Seed images under /img are never touched. */
export function removeUpload(ref) {
  if (!ref) return;
  let file = null;
  if (String(ref).startsWith('/uploads/')) {
    const name = path.basename(ref);
    if (/^[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(name)) file = path.join(UPLOAD_DIR, name);
  } else {
    file = privatePath(ref);
  }
  if (file) fs.rm(file, { force: true }, () => {});
}

/** Find an uploaded file by field name in a multer `.any()` result. */
export function fileFor(req, field) {
  return (req.files || []).find((f) => f.fieldname === field) || null;
}

export function filesFor(req, field) {
  return (req.files || []).filter((f) => f.fieldname === field);
}
