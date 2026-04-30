/* eslint-disable @typescript-eslint/no-explicit-any */
import { db } from './db';

let webpushLib: any = null;

async function getWebPush() {
  if (webpushLib) return webpushLib;
  try {
    webpushLib = (await import('web-push')).default;
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    const email = process.env.VAPID_CONTACT_EMAIL || 'mailto:info@til-kural.kz';
    if (pub && priv) webpushLib.setVapidDetails(email, pub, priv);
    return webpushLib;
  } catch {
    return null;
  }
}

export interface PushPayload {
  title: string;
  body: string;
  url?: string;
  icon?: string;
}

export async function sendPushToUser(userId: string, payload: PushPayload) {
  const wp = await getWebPush();
  if (!wp || !process.env.VAPID_PRIVATE_KEY) return 0;
  const subs = await db.query('push_subscriptions', { user_id: userId });
  const json = JSON.stringify(payload);
  let sent = 0;
  for (const s of subs) {
    try {
      await wp.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        json,
      );
      sent++;
    } catch (err: any) {
      if (err?.statusCode === 404 || err?.statusCode === 410) {
        await db.delete('push_subscriptions', s.id);
      } else {
        console.error('[push] send error:', err?.statusCode, err?.body);
      }
    }
  }
  return sent;
}

export async function sendEmail(to: string, subject: string, text: string): Promise<boolean> {
  if (!process.env.SMTP_HOST) return false;
  try {
    const nm = await import('nodemailer').catch(() => null);
    if (!nm) return false;
    const t = nm.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
    await t.sendMail({
      from: process.env.SMTP_FROM || 'no-reply@til-kural.kz',
      to,
      subject,
      text,
    });
    return true;
  } catch (err) {
    console.error('[email] send error:', err);
    return false;
  }
}
