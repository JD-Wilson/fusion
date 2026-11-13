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
