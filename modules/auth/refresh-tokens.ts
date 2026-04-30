/**
 * Refresh-token store. Токен (32 байта) генерируется при логине,
 * клиенту отдаётся в httpOnly cookie `tk-refresh`. В БД хранится только
 * sha256-хэш, сам токен сервером не сохраняется.
 *
 * При истечении access-токена клиент дёргает /api/auth/refresh — мы
 * проверяем хэш, выдаём новый access (на 1h) и новый refresh (rotation).
 *
 * При logout/revoke — refreshed_tokens.revoked_at ставится в NOW(); при
 * следующем /refresh запрос отвергается → access становится невалидным
 * максимум через 1h.
 */
import crypto from 'node:crypto';
import { db } from './db';

const REFRESH_TTL_DAYS = 30;

export interface RefreshTokenRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  revoked_at?: string | null;
}

export function generateRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(token).digest('hex');
  return { token, hash };
}

export function hashRefresh(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export async function storeRefreshToken(
  userId: string,
  hash: string,
  meta: { ip?: string | null; ua?: string | null } = {},
): Promise<void> {
  const expiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
  try {
    await db.insert('refresh_tokens', {
      user_id: userId,
      token_hash: hash,
      expires_at: expiresAt,
      revoked_at: null,
      ip_address: meta.ip ?? null,
      user_agent: meta.ua ?? null,
    });
  } catch (err) {
    console.warn('[refresh-tokens] store failed:', err);
  }
}

/** Возвращает row если токен валиден (существует, не отозван, не истёк). */
export async function findValidRefresh(token: string): Promise<RefreshTokenRow | null> {
  const hash = hashRefresh(token);
  try {
    const row = (await db.findOne('refresh_tokens', { token_hash: hash })) as RefreshTokenRow | null;
    if (!row) return null;
    if (row.revoked_at) return null;
    if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
    return row;
  } catch {
    return null;
  }
}

export async function revokeRefresh(token: string): Promise<void> {
  const hash = hashRefresh(token);
  try {
    const row = (await db.findOne('refresh_tokens', { token_hash: hash })) as RefreshTokenRow | null;
    if (!row) return;
    await db.update('refresh_tokens', row.id, { revoked_at: new Date().toISOString() });
  } catch { /* ignore */ }
}

export async function revokeAllForUser(userId: string): Promise<void> {
  try {
    const rows = (await db.query('refresh_tokens', { user_id: userId })) as RefreshTokenRow[];
    const now = new Date().toISOString();
    for (const r of rows) {
      if (r.revoked_at) continue;
      await db.update('refresh_tokens', r.id, { revoked_at: now });
    }
  } catch { /* ignore */ }
}

export const REFRESH_COOKIE_NAME = 'tk-refresh';

export function buildRefreshCookie(token: string): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const maxAge = REFRESH_TTL_DAYS * 24 * 60 * 60;
  return `${REFRESH_COOKIE_NAME}=${token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

export function buildClearRefreshCookie(): string {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  return `${REFRESH_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`;
}

export function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  const needle = `${name}=`;
  for (const part of header.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(needle)) {
      try { return decodeURIComponent(trimmed.slice(needle.length)); } catch { return null; }
    }
  }
  return null;
}
