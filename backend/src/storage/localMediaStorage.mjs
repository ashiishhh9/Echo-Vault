import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const TYPES = {
  image: {
    'image/jpeg': ['jpg', (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
    'image/png': ['png', (b) => b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))],
    'image/webp': ['webp', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP'],
    'image/gif': ['gif', (b) => ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString())],
  },
  video: {
    'video/mp4': ['mp4', (b) => b.length >= 12 && b.subarray(4, 8).toString() === 'ftyp'],
    'video/quicktime': ['mov', (b) => b.length >= 12 && b.subarray(4, 8).toString() === 'ftyp'],
    'video/webm': ['webm', (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))],
  },
  audio: {
    'audio/mpeg': ['mp3', (b) => b.subarray(0, 3).toString() === 'ID3' || (b.length > 1 && b[0] === 0xff && (b[1] & 0xe0) === 0xe0)],
    'audio/wav': ['wav', (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE'],
    'audio/mp4': ['m4a', (b) => b.length >= 12 && b.subarray(4, 8).toString() === 'ftyp'],
    'audio/ogg': ['ogg', (b) => b.subarray(0, 4).toString() === 'OggS'],
    'audio/webm': ['webm', (b) => b.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))],
  },
};
const MAX_BYTES = { image: 10 * 1024 * 1024, video: 50 * 1024 * 1024, audio: 20 * 1024 * 1024 };

export function decodeMediaDataUrl(type, value) {
  if (typeof value !== 'string') throw new Error('Media data must be a data URL');
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(value);
  if (!match) throw new Error('Media data URL is invalid');
  const mimeType = match[1].toLowerCase();
  const specification = TYPES[type]?.[mimeType];
  if (!specification) throw new Error('Unsupported media content type');
  const buffer = Buffer.from(match[2], 'base64');
  if (buffer.toString('base64') !== match[2] || !specification[1](buffer)) throw new Error('Media content does not match its declared type');
  if (buffer.length > MAX_BYTES[type]) throw new Error('Media exceeds the allowed file size');
  return { mimeType, extension: specification[0], buffer };
}

export class LocalMediaStorage {
  constructor(root) { this.root = resolve(root); }

  async save(type, dataUrl) {
    const { mimeType, extension, buffer } = decodeMediaDataUrl(type, dataUrl);
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const id = randomUUID();
    const storageKey = `${id}.${extension}`;
    const target = this.#path(storageKey);
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, buffer, { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw error;
    }
    return { id, storageKey, mimeType, size: buffer.length };
  }

  async read(storageKey) { return readFile(this.#path(storageKey)); }

  async delete(storageKey) { await rm(this.#path(storageKey), { force: true }); }

  #path(storageKey) {
    if (typeof storageKey !== 'string' || storageKey.includes('..') || storageKey.includes('/') || storageKey.includes('\\') || extname(storageKey).length < 2) {
      throw new Error('Invalid media storage key');
    }
    const target = resolve(this.root, storageKey);
    if (!target.startsWith(`${this.root}${sep}`)) throw new Error('Invalid media storage key');
    return target;
  }
}
