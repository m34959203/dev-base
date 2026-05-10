const UPSTREAM_HOST = 'generativelanguage.googleapis.com';
const ALLOWED_PATH_PREFIX = /^\/v1(beta)?\//;
const ALLOWED_METHODS = new Set(['GET', 'POST', 'OPTIONS']);

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Proxy-Token, X-Goog-Api-Key',
    'Access-Control-Max-Age': '86400',
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!ALLOWED_METHODS.has(request.method)) {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (!env.PROXY_TOKEN) {
      return new Response(
        'Worker misconfigured: PROXY_TOKEN secret is not set',
        { status: 500 },
      );
    }
    if (request.headers.get('X-Proxy-Token') !== env.PROXY_TOKEN) {
      return new Response('Forbidden', { status: 403 });
    }

    const url = new URL(request.url);
    if (!ALLOWED_PATH_PREFIX.test(url.pathname)) {
      return new Response('Path not allowed', { status: 400 });
    }

    url.host = UPSTREAM_HOST;
    url.protocol = 'https:';
    url.port = '';

    const headers = new Headers(request.headers);
    headers.delete('X-Proxy-Token');
    headers.delete('host');
    headers.delete('cf-connecting-ip');
    headers.delete('cf-ipcountry');
    headers.delete('cf-ray');
    headers.delete('cf-visitor');
    headers.delete('x-forwarded-for');
    headers.delete('x-forwarded-proto');
    headers.delete('x-real-ip');

    const upstream = await fetch(url.toString(), {
      method: request.method,
      headers,
      body: request.method === 'GET' ? undefined : request.body,
      redirect: 'follow',
    });

    const responseHeaders = new Headers(upstream.headers);
    for (const [key, value] of Object.entries(corsHeaders(origin))) {
      responseHeaders.set(key, value);
    }
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  },
};
