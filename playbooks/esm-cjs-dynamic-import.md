# Playbook: ESM-only SDK в CommonJS приложении (Plesk/Passenger)

**Цель:** запустить ESM-only SDK (`@google/genai` v1.x, `node-fetch` v3+, `chalk` v5+, `nanoid` v4+ и т.п.) в CommonJS-приложении на Plesk Node.js / Phusion Passenger.

**Источник:** LifeCompass `app.js` 2026-05-15. `@google/genai` 1.41.0 — pure ESM (`"type": "module"`, `"main": "dist/node/index.mjs"`). При `require('@google/genai')` падает с `Error [ERR_REQUIRE_ESM]`.

## Симптом

```
require() of ES Module /var/.../node_modules/@google/genai/dist/node/index.cjs from app.js is not supported.
Instead change the require of index.js in @google/genai/dist/node/index.cjs to a dynamic import() which is available in all CommonJS modules.
```

В `/api/health` JSON это часто видно как:
```json
{ "geminiLoaded": false, "geminiError": "require() of ES Module..." }
```

## Почему нельзя просто перевести проект в ESM

Plesk Passenger ожидает `app.js` или `app.cjs` стартовый файл. ESM (`"type": "module"`) ломает совместимость со старым кодом, требует .mjs расширений и переписывания всех require → import. Динамический импорт — это узкий, локальный фикс, без миграции всего проекта.

## Решение

`require()` синхронный — заменяем на `await import()` асинхронный в IIFE-обёртке. Все side-effects (HTTP listen, регистрация routes) тоже сдвигаем в этот async-флоу.

### Минимальный паттерн

```js
// app.js (CommonJS)
const express = require('express');

let GoogleGenAI, Modality, ai = null;
let loadError = null;

async function init() {
  try {
    const genai = await import('@google/genai');   // ← вот это
    GoogleGenAI = genai.GoogleGenAI;
    Modality = genai.Modality;
  } catch (err) {
    loadError = err.message;
    console.error('SDK load failed:', err.message);
    return;
  }
  ai = new GoogleGenAI({ vertexai: true, project: process.env.GCP_PROJECT_ID, location: 'us-central1' });
}

const app = express();
app.get('/api/use-ai', async (req, res) => {
  if (!ai) return res.status(503).json({ error: 'NOT_READY' });
  // ... use ai ...
});

(async () => {
  await init();           // дождаться загрузки SDK
  app.listen(3000);       // только потом слушать
})();
```

## Ключевые моменты

1. **Не вызывать SDK-методы до `await init()`** — все route-handlers получают `null`. Решение: либо registrировать routes ПОСЛЕ init, либо проверять `if (!ai) return 503` в каждом.

2. **package.json** должен оставаться без `"type": "module"`. Это CJS-проект, и `app.js` остаётся CJS.

3. **Plesk Passenger startup file** — `app.js` (или `app.cjs` если нужно явно). Не менять.

4. **TypeScript** в CJS-проекте: `tsconfig.json` → `"module": "commonjs"`, `"target": "es2022"`. Динамический import работает на target ≥ es2020.

5. **Кэширование import**: повторный `await import('@google/genai')` возвращает закэшированный модуль, не падает на производительности.

## Когда НЕ использовать dynamic import

- Если проект уже на ESM (`"type": "module"`) — просто `import { GoogleGenAI } from '@google/genai'` на верхнем уровне.
- Если SDK выпустил CJS-совместимую версию (`require` снова работает) — откатиться к синхронному. Проверить: `cat node_modules/<pkg>/package.json | jq '.main, .exports'` — наличие `.cjs` без принудительного ESM.

## Diagnostic snippet для `/api/health`

```js
app.get('/api/health', (req, res) => {
  res.json({
    sdkLoaded: !!GoogleGenAI,
    sdkError: loadError,            // первая ошибка при init
    sdkVersion: GoogleGenAI ? require('@google/genai/package.json').version : null,
    nodeVersion: process.version,
    cwd: process.cwd(),
  });
});
```

После деплоя — `curl https://app.example.com/api/health` сразу скажет — загрузился SDK или нет.

## Связанные ESM-only SDK на 2026

Применять тот же паттерн:
- `@google/genai` v1.x
- `node-fetch` v3+ (есть alternatives: undici, native fetch в Node 18+)
- `chalk` v5+
- `nanoid` v4+
- `got` v12+
- `p-retry` v5+
- `@octokit/rest` v20+
- большинство modern utility-пакетов

Альтернатива для Node 18+: использовать native `fetch` (без node-fetch), `crypto.randomUUID()` (без nanoid).
