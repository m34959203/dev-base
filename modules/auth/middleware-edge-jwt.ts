import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { rateLimit, clientKey, rateLimitResponse } from './lib/rate-limit';

const locales = ['kk', 'ru'];
const defaultLocale = 'kk';

const SECURITY_HEADERS: Record<string, string> = {
  'x-frame-options': 'SAMEORIGIN',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'permissions-policy': 'camera=(), microphone=(self), geolocation=()',
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
};

function applySecurityHeaders(res: NextResponse) {
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) res.headers.set(k, v);
  return res;
}

// --- JWT HS256 verify для Edge runtime --------------------------------------
// Middleware крутится в Edge (Next 16), где jsonwebtoken/crypto (Node API) недоступны.
// Jose мы не тянем специально — +1 зависимость на один verify это overkill.
// Делаем минимальный HS256-verifier через WebCrypto: вручную разбираем 3 части JWT,
// считаем HMAC-SHA256(header.payload, secret), сравниваем с signature, проверяем `exp`.
// Возвращаем claims ТОЛЬКО если подпись валидна и срок не истёк.
function base64UrlDecodeToBytes(input: string): Uint8Array {
  const pad = input.length % 4 === 2 ? '==' : input.length % 4 === 3 ? '=' : '';
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + pad;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function base64UrlDecodeToString(input: string): string {
  const bytes = base64UrlDecodeToBytes(input);
  return new TextDecoder().decode(bytes);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface EdgeJWTClaims {
  id: string;
  email: string;
  role: string;
  name: string;
  exp?: number;
  iat?: number;
}

async function verifyJwtHS256(token: string, secret: string): Promise<EdgeJWTClaims | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [headerB64, payloadB64, sigB64] = parts;

    // Проверяем, что это действительно HS256 (иначе не наш токен).
    const header = JSON.parse(base64UrlDecodeToString(headerB64)) as { alg?: string; typ?: string };
    if (header.alg !== 'HS256') return null;

    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign', 'verify'],
    );
    // Пересобираем сигнатуру поверх header.payload и сравниваем base64url-формы.
    // (verify() требует ArrayBuffer, который конфликтует с типами TS-lib'а, поэтому
    // идём через sign + прямое сравнение строк — тоже constant-length).
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const signed = await crypto.subtle.sign('HMAC', key, data);
    const expected = bytesToBase64Url(new Uint8Array(signed));
    if (expected !== sigB64) return null;

    const payload = JSON.parse(base64UrlDecodeToString(payloadB64)) as EdgeJWTClaims;
    // Exp в секундах Unix-времени (как пишет jsonwebtoken).
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

const ADMIN_ROLES = new Set(['admin', 'editor', 'moderator']);

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Rate limiting for API ---
  if (pathname.startsWith('/api/')) {
    let rule: { limit: number; windowMs: number; scope: string } | null = null;
    if (
      pathname.startsWith('/api/auth/login') ||
      pathname.startsWith('/api/auth/register') ||
      pathname.startsWith('/api/auth/forgot-password') ||
      pathname.startsWith('/api/auth/reset-password')
    ) {
      rule = { limit: 10, windowMs: 60_000, scope: 'auth' };
    } else if (pathname.startsWith('/api/photo-check')) {
      // Anon photo-check жёстче, чтобы не жгли Gemini Vision API.
      // Авторизованные ходят под `requireAdminApi` или внутренней rate-limit logic'ой.
      rule = { limit: 5, windowMs: 60_000, scope: 'photo-anon' };
    } else if (pathname.startsWith('/api/learn/tts')) {
      rule = { limit: 30, windowMs: 60_000, scope: 'tts' };
    } else if (pathname.startsWith('/api/learn/')) {
      rule = { limit: 40, windowMs: 60_000, scope: 'ai' };
    } else if (pathname.startsWith('/api/upload')) {
      rule = { limit: 20, windowMs: 60_000, scope: 'upload' };
    } else if (pathname.startsWith('/api/push')) {
      rule = { limit: 10, windowMs: 60_000, scope: 'push' };
    } else if (pathname.startsWith('/api/contact')) {
      rule = { limit: 5, windowMs: 60_000, scope: 'contact' };
    } else if (pathname.startsWith('/api/admin/')) {
      // Защита админ-API от brute-force и massive scraping.
      rule = { limit: 60, windowMs: 60_000, scope: 'admin' };
    }
    if (rule) {
      const key = clientKey(request, rule.scope);
      const r = rateLimit(key, rule.limit, rule.windowMs);
      if (!r.ok) return rateLimitResponse(r);
    }
    return applySecurityHeaders(NextResponse.next());
  }

  // Skip static files and favicons
  if (pathname.startsWith('/_next') || pathname.startsWith('/favicon') || pathname.startsWith('/uploads/') || pathname.includes('.')) {
    return applySecurityHeaders(NextResponse.next());
  }

  // --- Admin gate: /{kk,ru}/admin(/...) -----------------------------------
  // До i18n-редиректа, т.к. эти пути уже содержат локаль.
  const adminMatch = pathname.match(/^\/(kk|ru)\/admin(\/.*)?$/);
  if (adminMatch) {
    const locale = adminMatch[1];

    // DEV-bypass: работает ТОЛЬКО вне прода. На проде переменная игнорируется.
    if (process.env.NODE_ENV !== 'production' && process.env.DEV_ADMIN_BYPASS === '1') {
      return applySecurityHeaders(NextResponse.next());
    }

    const token = request.cookies.get('tk-token')?.value;
    const secret = process.env.JWT_SECRET || 'dev-secret-change-me';
    const claims = token ? await verifyJwtHS256(token, secret) : null;

    if (!claims || !ADMIN_ROLES.has(claims.role)) {
      const url = request.nextUrl.clone();
      url.pathname = `/${locale}/login`;
      url.searchParams.set('next', pathname);
      return applySecurityHeaders(NextResponse.redirect(url));
    }
    // Токен валиден и роль подходит — пропускаем дальше, страница сама ещё раз
    // проверит роль серверно через requireAdminApi на каждом API-вызове.
    return applySecurityHeaders(NextResponse.next());
  }

  // i18n routing
  const pathnameHasLocale = locales.some(
    (locale) => pathname.startsWith(`/${locale}/`) || pathname === `/${locale}`,
  );
  if (pathnameHasLocale) return applySecurityHeaders(NextResponse.next());

  // Let sitemap/robots through unprefixed
  if (pathname === '/sitemap.xml' || pathname === '/robots.txt' || pathname === '/manifest.webmanifest') {
    return applySecurityHeaders(NextResponse.next());
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${defaultLocale}${pathname}`;
  return applySecurityHeaders(NextResponse.redirect(url));
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
