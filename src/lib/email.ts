/**
 * Minimal Resend client (https://resend.com) using fetch. Without
 * RESEND_API_KEY emails are skipped; enquiries are still saved in the portal.
 */
export async function sendEmail({
  to,
  subject,
  text,
  replyTo
}: {
  to: string[];
  subject: string;
  text: string;
  replyTo?: string;
}): Promise<boolean> {
  const key = import.meta.env.RESEND_API_KEY;
  const from = import.meta.env.EMAIL_FROM ?? 'Fusion FC <onboarding@resend.dev>';
  if (!key || to.length === 0) return false;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to, subject, text, reply_to: replyTo })
    });
    if (!res.ok) {
      console.error(`[email] Resend ${res.status}: ${await res.text()}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[email] send failed', err);
    return false;
  }
}
