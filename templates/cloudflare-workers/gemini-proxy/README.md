# Gemini Proxy Worker

Прокси Cloudflare Worker для `generativelanguage.googleapis.com`. Нужен на серверах, чьи IP заблокированы Google по геолокации (`FAILED_PRECONDITION: User location is not supported`) — типичная история для VPS в KZ/RU/CN.

## Что делает

- Принимает запросы по `/v1beta/...` и `/v1/...`, форвардит на Google.
- Требует заголовок `X-Proxy-Token` с секретом → защита от чужих, кто узнает URL.
- Стрипает CF-хедеры (`cf-connecting-ip`, `x-forwarded-for` и т.п.), чтобы Google видел только origin воркера в US/EU.
- Поддерживает CORS, чтобы можно было дёргать из браузера.
- Отказывается работать без секрета (защита от случайного публичного деплоя).

## Деплой через дашборд (без CLI)

1. https://dash.cloudflare.com → Workers & Pages → Create → Create Worker.
2. Имя: `gemini-proxy` (или своё). Deploy.
3. Edit code → удалить дефолтный код, вставить содержимое `worker.js`. Save and Deploy.
4. Settings → Variables and Secrets → Add → **Type: Secret** → Name: `PROXY_TOKEN`, Value: длинная случайная строка (например `openssl rand -hex 32`). Save.
5. Settings → Domains & Routes → видно URL: `https://gemini-proxy.<sub>.workers.dev`. Это и есть `GEMINI_API_BASE/...`.

## Деплой через wrangler CLI

```bash
cd /home/ubuntu/dev-base/templates/cloudflare-workers/gemini-proxy
npx wrangler login          # один раз
npx wrangler deploy         # деплой
echo "<token>" | npx wrangler secret put PROXY_TOKEN
```

## Использование в приложении

```env
GEMINI_API_BASE=https://gemini-proxy.<sub>.workers.dev/v1beta/models
GEMINI_PROXY_TOKEN=<тот же секрет>
GEMINI_API_KEY=<обычный ключ AI Studio>
```

Бэкенд должен:
- собирать URL как `${GEMINI_API_BASE}/${model}:generateContent?key=${GEMINI_API_KEY}`;
- слать заголовок `X-Proxy-Token: ${GEMINI_PROXY_TOKEN}`.

## Лимиты

- Workers Free: 100 000 запросов/сутки, 10 мс CPU/запрос (для прокси хватает с запасом — мы сами не считаем).
- Если упрёшься — Workers Paid даёт 10M req/мес за $5.

## Ротация токена

1. В дашборде Variables → удалить старый секрет, добавить новый.
2. Worker применит изменение мгновенно.
3. Обновить `GEMINI_PROXY_TOKEN` в `.env` потребителей и перезапустить их.

## Что под капотом

Воркер ничего не парсит — это голый HTTP-прокси. Стримы (`alt=sse`) проходят прозрачно через `Response(upstream.body, ...)`. Бинарка для TTS-аудио тоже работает, тело передаётся как ReadableStream без чтения.
