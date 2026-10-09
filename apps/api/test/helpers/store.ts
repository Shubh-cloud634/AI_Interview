import type { ObjectStore } from '../../src/storage/object-store';

/** In-memory ObjectStore. Tests "upload" with put(), as a browser would PUT to the signed URL. */
export class MemoryStore implements ObjectStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly removed: string[] = [];

  async createUploadUrl(key: string, contentType: string) {
    return {
      url: `https://storage.test/upload/${encodeURIComponent(key)}`,
      headers: { 'content-type': contentType },
      expiresAt: new Date(Date.now() + 3600_000),
    };
  }

  async get(key: string, maxBytes: number) {
    const bytes = this.objects.get(key);
    if (!bytes) return null;
    if (bytes.byteLength > maxBytes) throw new Error('object exceeds size limit');
    return bytes;
  }

  async remove(keys: string[]) {
    for (const k of keys) {
      this.objects.delete(k);
      this.removed.push(k);
    }
  }

  put(key: string, data: string | Uint8Array) {
    this.objects.set(key, typeof data === 'string' ? new TextEncoder().encode(data) : data);
  }
}
