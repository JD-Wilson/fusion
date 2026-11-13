/** Trimmed text field, or null when empty. */
export function text(form: FormData, key: string, max = 2000): string | null {
  const value = String(form.get(key) ?? '').trim().slice(0, max);
  return value || null;
}

/** Single-line text: control characters stripped (safe for email subjects). */
export function line(form: FormData, key: string, max = 200): string | null {
  const value = text(form, key, max)?.replace(/[\u0000-\u001f\u007f]+/g, ' ').trim();
  return value || null;
}

export const checked = (form: FormData, key: string) => form.get(key) === 'on';

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_]+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 60);
}

/** Only allow redirects back into the portal. */
export function safeNext(value: string | null | undefined): string {
  const next = value ?? '';
  return next.startsWith('/portal') && !next.startsWith('//') ? next : '/portal/';
}
