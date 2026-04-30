# Playbook: автопубликация в соцсети (Telegram + Instagram)

**Цель:** при публикации статьи / новости автоматически постить в TG-канал и IG-аккаунт. Идемпотентно (повтор не дублирует), безопасно (credentials encrypted), отказоустойчиво (retry с exponential backoff).

**Источник:** technokod `src/lib/social/*` + `src/lib/scheduler.ts` (production).

## Архитектура

```
Article published
  ↓
publisher.publishArticle(articleId, ['telegram', 'instagram'], ['ru', 'kk'])
  ↓
foreach platform × language:
  1. existingSuccess(articleId, platform, lang)? → skip (idempotent)
  2. pickConfig(platform, lang) — выбор активного аккаунта
  3. format caption по templates
  4. send via telegram.ts / instagram.ts
     ├─ retry x3 с exponential backoff
     └─ Instagram: container → poll FINISHED → publish
  5. record SocialMediaPublication(status=success|failed)
```

## Файлы

- [`modules/social/`](../modules/social/) — publisher + telegram + instagram + encryption + templates
- [`modules/scheduler/scheduler.ts`](../modules/scheduler/scheduler.ts) — durable jobs (см. [`scheduler-cron.md`](scheduler-cron.md))
- [`modules/scheduler/api-cron-tick/route.ts`](../modules/scheduler/api-cron-tick/route.ts) — внешний cron endpoint

## Установка

### 1. Зависимости

```bash
npm install axios
# Если используешь Prisma:
npx prisma migrate dev --name add_social_publisher
```

### 2. Schema (Prisma)

См. [`modules/social/README.md`](../modules/social/README.md) — модели `SocialMediaConfig`, `SocialMediaPublication`, `ScheduledJob`.

### 3. Env

```env
# 32-байтовый ключ для AES-256-GCM
SOCIAL_ENCRYPTION_KEY=<64-hex-chars>   # openssl rand -hex 32

# Cron secret для внешнего поллера
CRON_SECRET=<random-32-chars>
```

### 4. Положить файлы

```bash
mkdir -p src/lib/social src/app/api/cron/tick
cp <dev-base>/modules/social/*.ts src/lib/social/
cp <dev-base>/modules/scheduler/scheduler.ts src/lib/scheduler.ts
cp <dev-base>/modules/scheduler/api-cron-tick/route.ts src/app/api/cron/tick/route.ts
```

Адаптировать импорты `@/lib/db` (Prisma) под свой стек.

## Конфигурация социальных аккаунтов

Через админку `/admin/social` (см. wave-3 admin-shell) — в БД пишется `SocialMediaConfig` с **зашифрованными** credentials.

### Telegram

1. Создать бота: [@BotFather](https://t.me/BotFather) → `/newbot` → получить `bot_token`.
2. Добавить бота админом в канал.
3. Узнать `chat_id` канала: `https://api.telegram.org/bot<TOKEN>/getUpdates` (или `@username` для public).
4. В админке создать SocialMediaConfig:
   ```json
   {
     "platform": "telegram",
     "language": "ru",
     "name": "Главный канал RU",
     "credentials": { "botToken": "...", "chatId": "@yourchannel" }
   }
   ```

### Instagram

1. Создать **Instagram Business** аккаунт (не Personal) → привязать к Facebook Page.
2. В Meta Developer Console → создать app → добавить Instagram Graph API.
3. Получить:
   - `accessToken` (long-lived, 60 дней; нужен auto-refresh!)
   - `userId` (Instagram Business ID)
   - `pageId` (Facebook Page ID)
4. В админке:
   ```json
   {
     "platform": "instagram",
     "language": "ru",
     "name": "Main IG",
     "credentials": { "accessToken": "...", "userId": "...", "pageId": "..." }
   }
   ```

**ВАЖНО:** `accessToken` IG живёт 60 дней. Без auto-refresh публикации перестанут работать. См. `instagram.ts:refreshAccessToken()`.

## Trigger публикации

### Способ 1: при публикации статьи (немедленно)

```ts
// app/api/admin/articles/[id]/publish/route.ts
import { publishArticle } from '@/lib/social/publisher';

await prisma.article.update({ where: { id }, data: { status: 'published', publishedAt: new Date() }});
await publishArticle({ articleId: id, platforms: ['telegram', 'instagram'], languages: ['ru', 'kk'] });
```

### Способ 2: scheduled (через `scheduler.ts`)

```ts
import { enqueue } from '@/lib/scheduler';

await enqueue({
  type: 'PUBLISH_ARTICLE',
  payload: { articleId: id, platforms: ['telegram'], languages: ['ru'] },
  runAt: new Date('2026-05-01T12:00:00Z'),
});
```

Worker (cron) автоматически подхватит когда `runAt <= NOW`.

### Способ 3: optimal-time slots

Из smart-kids-library `lib/auto-social.ts`: TG лучше идёт в 12:00 локального времени, IG в 19:00. При создании job:

```ts
const slot = nextOptimalSlot('telegram', timezoneOffset);
await enqueue({ type: 'PUBLISH_ARTICLE', payload: {...}, runAt: slot });
```

## Caption templates

В `templates.ts`:

```ts
formatTelegramCaption({
  title: '...',           // Заголовок
  excerpt: '...',         // Краткое описание
  category: 'news',       // → emoji 📰 / events → 🎉 / etc
  breaking: false,        // → префикс «🔥 СРОЧНО:»
  tags: ['tag1', 'tag2'], // → нижняя строка #tag1 #tag2
  url: '...'              // → кнопка «Подробнее» (или гиперссылка)
})
// → HTML-escaped, готовый caption для Telegram API
```

Адаптируй emoji-mapping и формат под свою категорию.

## Подводные камни

### Telegram

- **HTML vs Markdown** — HTML надёжнее, Markdown_v2 требует escape почти всех символов.
- **caption max 1024 символа** — для photos. Для message-only (sendMessage) — 4096.
- **Каналы vs группы vs боты** — bot должен быть **админом** канала. В группах работает не везде.
- **IPv4-only axios** — на некоторых VPS IPv6 timeouts ломают retry-loop.

### Instagram

- **Long-lived access token истекает в 60 дней** — обязательно auto-refresh за 7 дней до конца.
- **Container polling** — между `createImageContainer` и `publishContainer` нужно ждать `status_code === FINISHED`. Возможные статусы: `IN_PROGRESS`, `FINISHED`, `ERROR`, `EXPIRED`.
- **Reels processing** — 30-90 сек. timeout polling — минимум 120 сек.
- **`is_transient: true` ошибки** — retry; иначе не ретраить.
- **Image URL должен быть public HTTPS** (не data: и не private S3 без signed URL).
- **Минимальный размер** — 320×320, иначе IG отвергает. Aspect ratio 4:5–1.91:1.

### Idempotency

- Unique constraint `(articleId, platform, language)` — гарантия одного успешного поста на тройку.
- При повторном `publishArticle()` старые **failed** перезаписываются попытками; **success** не трогаются.

### Безопасность

- **Никогда не логировать** `config.credentials` (encrypted blob) или результат decrypt.
- При компрометации `SOCIAL_ENCRYPTION_KEY` — все credentials в БД нужно перешифровать новым ключом.
- Telegram bot token и IG accessToken **отзываемы** в источниках (BotFather / Meta Developer Console) — при инциденте отзывать там.

## Альтернативы / расширения

- **Facebook Pages** — добавить `facebook.ts` (Graph API, очень похож на Instagram).
- **VK API** — `vkontakte.ts` (`wall.post`, токен из `oauth.vk.com`).
- **X (Twitter) v2** — `twitter.ts` (Bearer token, `POST /2/tweets`).
- **LinkedIn Pages** — `linkedin.ts`.
- **Threads** — официально через IG API (тот же accessToken).

См. также:
- [`scheduler-cron.md`](scheduler-cron.md) — durable job runner
- [`modules/social/README.md`](../modules/social/README.md) — детали по каждому файлу
