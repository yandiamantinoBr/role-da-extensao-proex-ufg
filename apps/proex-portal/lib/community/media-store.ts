import { bucket } from '../platform';

/*
 * Single storage interface for chat images (premise A, 2026-11-09): private objects in the same store as the
 * material photos (Postgres `objects` on Vercel). To move to Supabase Storage (private bucket, signed reads),
 * implement this interface and change only `chatMediaStore()`. The chat code never touches the bucket directly.
 */
export type MediaStore = {
  put(key: string, data: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<{ data: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
};
export function bucketMediaStore(target: R2Bucket): MediaStore {
  return {
    async put(key, data, contentType) { await target.put(key, data, { httpMetadata: { contentType } }); },
    // Read through the stream: the Node object adapter's arrayBuffer() may expose a pooled buffer larger than the object.
    async get(key) { const found = await target.get(key); return found ? { data: new Uint8Array(await new Response(found.body).arrayBuffer()), contentType: found.httpMetadata?.contentType ?? 'application/octet-stream' } : null; },
    async delete(key) { await target.delete(key); },
  };
}
export function chatMediaStore(): MediaStore { return bucketMediaStore(bucket()); }
