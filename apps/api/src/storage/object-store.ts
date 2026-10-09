import type { Config } from '../config';

/** Object storage for resumes. Files are never served from the API origin. */
export interface ObjectStore {
  createUploadUrl(key: string, contentType: string): Promise<{ url: string; headers: Record<string, string>; expiresAt: Date }>;
  /** Returns null if absent. Rejects objects larger than maxBytes without buffering them fully. */
  get(key: string, maxBytes: number): Promise<Uint8Array | null>;
  remove(keys: string[]): Promise<void>;
}

/** Supabase Storage over its REST API with the server-only service key. */
export function createSupabaseStore(config: Config): ObjectStore {
  const base = `${config.SUPABASE_URL.replace(/\/$/, '')}/storage/v1`;
  const bucket = config.RESUME_BUCKET;
  const key = config.SUPABASE_SERVICE_ROLE_KEY;
  const auth = () => {
    if (!key) throw new Error('SUPABASE_SERVICE_ROLE_KEY is required for storage');
    return { apikey: key, authorization: `Bearer ${key}` };
  };
  const path = (k: string) => k.split('/').map(encodeURIComponent).join('/');

  return {
    async createUploadUrl(objectKey, contentType) {
      const res = await fetch(`${base}/object/upload/sign/${bucket}/${path(objectKey)}`, {
        method: 'POST',
        headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(`storage sign failed: ${res.status}`);
      const body = (await res.json()) as { url: string };
      // Supabase signed upload URLs are valid for two hours.
      return { url: `${base}${body.url}`, headers: { 'content-type': contentType }, expiresAt: new Date(Date.now() + 2 * 3600_000) };
    },
    async get(objectKey, maxBytes) {
      const res = await fetch(`${base}/object/authenticated/${bucket}/${path(objectKey)}`, { headers: auth() });
      if (res.status === 404 || res.status === 400) return null;
      if (!res.ok || !res.body) throw new Error(`storage get failed: ${res.status}`);
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of res.body as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > maxBytes) throw new Error('object exceeds size limit');
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    },
    async remove(keys) {
      if (keys.length === 0) return;
      const res = await fetch(`${base}/object/${bucket}`, {
        method: 'DELETE',
        headers: { ...auth(), 'content-type': 'application/json' },
        body: JSON.stringify({ prefixes: keys }),
      });
      if (!res.ok) throw new Error(`storage delete failed: ${res.status}`);
    },
  };
}
