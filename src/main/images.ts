import { copyFileSync, existsSync, mkdirSync } from 'fs';
import { extname, join } from 'path';
import { randomBytes } from 'crypto';
import { dataDir } from '../database/index.js';
import { AppError } from '../domain/errors.js';

const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);

/**
 * Copy a user-chosen image into the app data dir and return its relative path
 * (e.g. "product-images/ab12cd34.png"). Served to the renderer via the
 * orderly-img:// protocol — never expose absolute filesystem paths.
 */
export function saveProductImage(srcPath: string): string {
  if (!existsSync(srcPath)) throw new AppError('IO', 'Image file not found.');
  const ext = extname(srcPath).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new AppError('VALIDATION', 'Image must be a PNG, JPG, WebP, or GIF file.');
  }
  const dir = join(dataDir(), 'product-images');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const name = `${randomBytes(8).toString('hex')}${ext}`;
  copyFileSync(srcPath, join(dir, name));
  return `product-images/${name}`;
}

/** Resolve a stored relative image path to an absolute file path, guarded against traversal. */
export function resolveImagePath(rel: string): string | null {
  const base = dataDir();
  const full = join(base, rel);
  if (!full.startsWith(base + '/') && full !== base) return null;
  if (!existsSync(full)) return null;
  return full;
}
