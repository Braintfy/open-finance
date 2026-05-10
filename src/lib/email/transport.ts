// PURPOSE: Транспорт почты через nodemailer.
// Beget по умолчанию: smtp.beget.com:465 (SSL) или :2525 (TLS).
// В dev (без SMTP_HOST) — пишет письмо в консоль вместо отправки.

import nodemailer, { type Transporter } from 'nodemailer';
import { env } from '@/lib/env';

let cached: Transporter | null = null;

function buildTransport(): Transporter | null {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASSWORD) {
    return null;
  }
  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT ?? 465,
    secure: (env.SMTP_PORT ?? 465) === 465, // SSL для 465, STARTTLS для 587/2525
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASSWORD,
    },
  });
}

export function getTransport(): Transporter | null {
  if (cached) return cached;
  cached = buildTransport();
  return cached;
}

export type MailMessage = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendMail(msg: MailMessage): Promise<{ ok: true } | { ok: false; error: string }> {
  const t = getTransport();
  const from = env.SMTP_FROM || env.SMTP_USER || 'noreply@openfinance.local';

  if (!t) {
    // Dev fallback — пишем в консоль
    console.log('═══ [EMAIL: dev fallback] ═══');
    console.log(`From: ${from}`);
    console.log(`To: ${msg.to}`);
    console.log(`Subject: ${msg.subject}`);
    console.log('---');
    console.log(msg.text ?? msg.html.replace(/<[^>]+>/g, ''));
    console.log('═════════════════════════════');
    return { ok: true };
  }

  try {
    await t.sendMail({
      from,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
    });
    return { ok: true };
  } catch (e) {
    console.error('[email] send failed:', e);
    return { ok: false, error: e instanceof Error ? e.message : 'unknown' };
  }
}
