import type { SupabaseClient } from '@supabase/supabase-js';
import { slugify } from './forms';

export const MEDIA_BUCKET = 'site-media';

const TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'application/pdf': 'pdf'
};
/** Uploads go through the website's server, which accepts up to ~4.5MB per request. */
const MAX_BYTES = 4 * 1024 * 1024;

export type UploadResult = { url: string | null; error?: string };

/**
 * Upload a photo or PDF to the public `site-media` bucket (club admins only,
 * enforced by storage policies). Images are shrunk in the browser first
 * (data-resize inputs), so phone photos fit. Returns null when no file was chosen.
 */
export async function uploadMedia(
  supabase: SupabaseClient,
  file: FormDataEntryValue | null,
  folder: 'images' | 'documents',
  { pdfOnly = false, imagesOnly = false } = {}
): Promise<UploadResult> {
  if (!(file instanceof File) || file.size === 0) return { url: null };
  const ext = TYPES[file.type];
  if (!ext || (pdfOnly && ext !== 'pdf') || (imagesOnly && ext === 'pdf')) {
    return { url: null, error: pdfOnly ? 'Please choose a PDF.' : imagesOnly ? 'Please choose a JPEG, PNG, WebP or GIF image.' : 'Please choose an image or a PDF.' };
  }
  if (file.size > MAX_BYTES) {
    return { url: null, error: 'That file is over 4MB. Please choose a smaller one (for PDFs, try "Reduce file size" when saving).' };
  }
  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'file';
  const path = `${folder}/${Date.now()}-${base}.${ext}`;
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, file, {
    contentType: file.type,
    cacheControl: '31536000',
    upsert: false
  });
  if (error) return { url: null, error: `Upload failed: ${error.message}` };
  return { url: supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl };
}

export type MediaItem = { path: string; name: string; url: string; isPdf: boolean; created: string; size: number };

/** Uploaded files in one folder, newest first. */
export async function listMedia(supabase: SupabaseClient, folder: 'images' | 'documents'): Promise<{ items: MediaItem[]; error?: string }> {
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .list(folder, { limit: 300, sortBy: { column: 'created_at', order: 'desc' } });
  if (error) return { items: [], error: error.message };
  return {
    items: (data ?? [])
      .filter((f) => f.id && !f.name.startsWith('.'))
      .map((f) => {
        const path = `${folder}/${f.name}`;
        return {
          path,
          name: f.name.replace(/^\d+-/, ''),
          url: supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl,
          isPdf: folder === 'documents',
          created: f.created_at ?? '',
          size: Number((f.metadata as { size?: number } | null)?.size ?? 0)
        };
      })
  };
}

/** Where each uploaded file is used: page and post titles, keyed by file URL. */
export async function mediaUsage(supabase: SupabaseClient, urls: string[]): Promise<Map<string, string[]>> {
  const [pages, posts, teams] = await Promise.all([
    supabase.from('site_pages').select('title, body, hero_image, attachment_url'),
    supabase.from('posts').select('title, body, cover_image'),
    supabase.from('teams').select('name, photo_url')
  ]);
  const sources = [
    ...(pages.data ?? []).map((p) => ({ label: p.title as string, text: [p.body, p.hero_image, p.attachment_url].join(' ') })),
    ...(posts.data ?? []).map((p) => ({ label: `Blog: ${p.title}`, text: [p.body, p.cover_image].join(' ') })),
    ...(teams.data ?? []).map((t) => ({ label: `Team: ${t.name}`, text: String(t.photo_url ?? '') }))
  ];
  return new Map(urls.map((url) => [url, sources.filter((s) => s.text.includes(url)).map((s) => s.label)]));
}

/** "1.2 MB", "340 KB". */
export const fileSize = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : bytes > 0 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : '';
