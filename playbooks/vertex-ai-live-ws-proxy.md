# Playbook: Vertex AI Live API через WebSocket-прокси на бэке

**Цель:** запустить голосовой Live-диалог через Vertex AI безопасно — браузер никогда не видит ни SA JSON, ни OAuth-токен; всё проксируется через свой бэк.

**Источник:** LifeCompass `lifecompass.zhezu.kz` миграция 2026-05-15 (репо `m34959203/LifeCompass`, ветка `feat/vertex-ai-live-migration`).

## Когда это нужно

- Vertex AI Live API нужен для голосовых диалогов (psychdiagnostics, voice-assistant, support-чат).
- Требование безопасности: ключи / OAuth-токены **не должны попадать на фронт**.
- `@google/genai` SDK на Vertex **не поддерживает** `authTokens.create()` (короткоживущие токены доступны только в Gemini Developer API). См. `feedback_gemini_vertex_no_ephemeral.md` в memory.

## Архитектура

```
[Browser]
   │ WebSocket: wss://app.example.com/ws/live?token=<5min-token>
   ▼
[Express server]
   │ One-time WS token (5 min, in-memory Map)
   │ @google/genai в Vertex mode (SA JSON через ADC)
   │ ai.live.connect({ model, callbacks, config })
   ▼
[Vertex AI Live API]
   wss://us-central1-aiplatform.googleapis.com/...
```

**Безопасность:**
- SA JSON живёт **только на сервере** (`GOOGLE_APPLICATION_CREDENTIALS=/var/.../private/sa.json`, вне webroot).
- Фронт получает короткоживущий WS-token (5 минут, одноразовый) через `POST /api/live/session`.
- Любой утёкший WS-token — мёртв через 5 минут после выдачи, и одноразовый.

## Известные ловушки Vertex AI Live

1. **Имена моделей в Vertex и Gemini Developer API РАЗНЫЕ.**
   - Gemini Dev API: `gemini-2.5-flash-native-audio-preview-12-2025`
   - Vertex AI:       `gemini-live-2.5-flash-native-audio` (без preview/даты)
   - Узнать актуальное:
     ```bash
     GET https://us-central1-aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=200 \
       -H "Authorization: Bearer $TOKEN"
     # filter by 'live' / 'native-audio' in name
     ```

2. **Live API только в `us-central1`** — в `global` location не работает.

3. **SDK v1.x — ESM-only.** В CommonJS-приложениях `require('@google/genai')` падает. Использовать dynamic import (см. playbook `esm-cjs-dynamic-import.md`).

4. **`closeReason` обрезается** на ~100 символов в onclose callback — для дебага полное сообщение посмотреть в trace SDK или через REST.

## Имплементация

### 1. Backend Express + WebSocket

```js
const http = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

let GoogleGenAI, Modality, ai = null;
async function initVertex() {
  const genai = await import('@google/genai');
  GoogleGenAI = genai.GoogleGenAI;
  Modality = genai.Modality;
  ai = new GoogleGenAI({
    vertexai: true,
    project: process.env.GCP_PROJECT_ID,
    location: process.env.GCP_LOCATION,    // us-central1
    googleAuthOptions: { keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS },
  });
}

const liveTokens = new Map();  // token → { systemInstruction, initialMessage, createdAt }
setInterval(() => {
  const now = Date.now();
  for (const [t, v] of liveTokens) if (now - v.createdAt > 5*60*1000) liveTokens.delete(t);
}, 5*60*1000);

// One-time WS session token
app.post('/api/live/session', (req, res) => {
  if (!ai) return res.status(503).json({ error: 'API_NOT_CONFIGURED' });
  const token = crypto.randomBytes(24).toString('base64url');
  liveTokens.set(token, {
    systemInstruction: (req.body.systemInstruction || '') + TOPIC_GUARD,
    initialMessage: req.body.initialMessage || '',
    createdAt: Date.now(),
  });
  res.json({ token, expiresInSec: 300 });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname !== '/ws/live') { socket.destroy(); return; }
  const token = url.searchParams.get('token');
  if (!token || !liveTokens.has(token)) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy(); return;
  }
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, token);
  });
});

wss.on('connection', async (ws, req, token) => {
  const session = liveTokens.get(token);
  liveTokens.delete(token); // single-use

  const send = (obj) => ws.readyState === ws.OPEN && ws.send(JSON.stringify(obj));

  const liveSession = await ai.live.connect({
    model: 'gemini-live-2.5-flash-native-audio',
    config: {
      responseModalities: [Modality.AUDIO],
      systemInstruction: session.systemInstruction,
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      inputAudioTranscription: {},
      outputAudioTranscription: {},
    },
    callbacks: {
      onopen: () => send({ type: 'open' }),
      onmessage: (msg) => {
        const sc = msg.serverContent;
        if (!sc) return;
        for (const part of sc.modelTurn?.parts || []) {
          if (part.inlineData?.data) send({ type: 'audio', mimeType: part.inlineData.mimeType, data: part.inlineData.data });
          else if (part.text) send({ type: 'text', text: part.text });
        }
        if (sc.inputTranscription?.text) send({ type: 'transcription', role: 'user', text: sc.inputTranscription.text });
        if (sc.outputTranscription?.text) send({ type: 'transcription', role: 'model', text: sc.outputTranscription.text });
        if (sc.turnComplete) send({ type: 'turn-complete' });
      },
      onerror: (e) => send({ type: 'error', message: e?.message || 'live_error' }),
      onclose: (e) => { send({ type: 'closed', reason: e?.reason || '' }); ws.close(); },
    },
  });

  // initial greeting on behalf of user
  if (session.initialMessage) setTimeout(() => liveSession.sendClientContent({
    turns: [{ role: 'user', parts: [{ text: session.initialMessage }] }],
    turnComplete: true,
  }), 500);

  ws.on('message', (raw) => {
    const m = JSON.parse(raw.toString());
    if (m.type === 'realtime-input') liveSession.sendRealtimeInput({ media: { mimeType: m.mimeType, data: m.data } });
    else if (m.type === 'client-content') liveSession.sendClientContent({ turns: m.turns, turnComplete: m.turnComplete !== false });
    else if (m.type === 'close') liveSession.close();
  });

  ws.on('close', () => { try { liveSession.close(); } catch {} });
});
```

### 2. Frontend (TypeScript, без `@google/genai` SDK)

```ts
class LiveWsClient {
  private ws: WebSocket;
  constructor(token: string, callbacks: { onopen?(), onmessage?(msg), onerror?(e), onclose?(e) }) {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${scheme}://${location.host}/ws/live?token=${encodeURIComponent(token)}`);
    this.ws.onmessage = (event) => {
      const payload = JSON.parse(event.data);
      if (payload.type === 'open') return callbacks.onopen?.();
      if (payload.type === 'error') return callbacks.onerror?.(new Error(payload.message));
      if (payload.type === 'closed') return callbacks.onclose?.({ reason: payload.reason });
      // SDK-shape compatibility (reconstruct serverContent)
      const out: any = { serverContent: {} };
      if (payload.type === 'audio') out.serverContent.modelTurn = { parts: [{ inlineData: { data: payload.data, mimeType: payload.mimeType } }] };
      else if (payload.type === 'transcription') {
        if (payload.role === 'user') out.serverContent.inputTranscription = { text: payload.text };
        else out.serverContent.outputTranscription = { text: payload.text };
      } else if (payload.type === 'turn-complete') out.serverContent.turnComplete = true;
      callbacks.onmessage?.(out);
    };
    this.ws.onerror = (e) => callbacks.onerror?.(e);
    this.ws.onclose = (e) => callbacks.onclose?.(e);
  }
  sendRealtimeInput(p: { media: { data: string; mimeType: string } }) {
    this.ws.send(JSON.stringify({ type: 'realtime-input', mimeType: p.media.mimeType, data: p.media.data }));
  }
  sendClientContent(p: { turns: any[]; turnComplete?: boolean }) {
    this.ws.send(JSON.stringify({ type: 'client-content', turns: p.turns, turnComplete: p.turnComplete !== false }));
  }
  close() { try { this.ws.send(JSON.stringify({ type: 'close' })); } catch {} ; this.ws.close(); }
}

// usage:
const { token } = await fetch('/api/live/session', { method: 'POST', body: JSON.stringify({...}) }).then(r => r.json());
const session = new LiveWsClient(token, { onopen, onmessage, onerror, onclose });
session.sendRealtimeInput({ media: pcmBlob });  // mic audio
session.sendClientContent({ turns: [...], turnComplete: true }); // text/initial prompts
```

### 3. Deploy на Plesk (Hoster.kz / любой Passenger)

`Plesk → Domains → app.example.com → Node.js → Environment Variables`:
```
GCP_PROJECT_ID=zhezu-052026
GCP_LOCATION=us-central1
GOOGLE_APPLICATION_CREDENTIALS=/var/www/vhosts/example.com/app/private/sa.json
```

SA JSON загрузить через FTP в `private/` (вне webroot `dist/`), `chmod 600`. После — `Install NPM` (для `ws`) → `Restart Application`.

## Стоимость

Vertex AI Gemini Live native-audio: **~$0.075/мин входящего аудио + $0.30/мин исходящего** (на 2026-05). $300 GCP trial = **~1000 минут** диалогов.

Для psychdiagnostics-сессии 5-10 минут одного диалога → trial покрывает ~100 сессий.

## Smoke-тест после деплоя

```bash
# 1. health
curl https://app.example.com/api/health
# ожидаем: {"vertexConfigured":true,"credsExists":true}

# 2. WS-token
TOKEN=$(curl -sX POST https://app.example.com/api/live/session \
  -H "Content-Type: application/json" \
  -d '{"systemInstruction":"Be brief.","initialMessage":"Say hi."}' \
  | jq -r .token)

# 3. WS connect (node)
node --input-type=module -e "
import WebSocket from 'ws';
const ws = new WebSocket('wss://app.example.com/ws/live?token=$TOKEN');
ws.on('message', (raw) => { const m = JSON.parse(raw); if (m.type === 'transcription') console.log(m.role + ':', m.text); });
setTimeout(() => process.exit(0), 10000);
"
# ожидаем: transcription role=model "Привет!..."
```

## Если не работает

- `Publisher Model ... was not found` → проверить имя модели через `GET .../publishers/google/models` REST (preview-имена меняются).
- `serviceTier: "free"` в response → проект на free tier, Live preview-модели могут быть закрыты — нужен paid или trial.
- WS закрывается сразу после `open` → почти всегда это про модель (см. выше). Smoke через `node --input-type=module -e` с прямым `ai.live.connect()` минуя свой WS.
- ESM/CJS error на старте → см. `esm-cjs-dynamic-import.md`.
