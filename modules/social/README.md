# modules/social/

Social media publisher kit для Telegram + Instagram. Production-tested в technokod.

## Файлы

- [`types.ts`](types.ts) — `SocialConfigLike`, `TelegramCredentials`, `InstagramCredentials`, language types.
- [`encryption.ts`](encryption.ts) — AES-256-GCM с `SOCIAL_ENCRYPTION_KEY` (hex 32-byte). Шифрование credentials at-rest в БД.
- [`credentials.ts`](credentials.ts) — helpers `getDecryptedCredentials(config)`.
- [`telegram.ts`](telegram.ts) — Bot API клиент: `sendMessage`, `sendPhoto`, retry x3, IPv4-forced axios, exponential backoff. `messageUrl()` для public/private каналов.
- [`instagram.ts`](instagram.ts) — Graph API 2-step: `createImageContainer` → `waitForContainer` (polling FINISHED/ERROR/EXPIRED) → `publishContainer`. Поддерживает Reels (videoUrl). `is_transient` retry.
- [`templates.ts`](templates.ts) — `formatTelegramCaption` (HTML-escape, emoji по category, breaking-flag, tags). `formatInstagramCaption` (bilingual + hashtags).
- [`publisher.ts`](publisher.ts) — orchestrator. Идемпотентен per (article, platform, lang). Loadbalanced между несколькими аккаунтами одной платформы.

## Зависимости

```json
{
  "axios": "^1.6.0",
  "@prisma/client": "^5.0.0"
}
```

## Схема БД (Prisma)

```prisma
model SocialMediaConfig {
  id          String   @id @default(uuid())
  platform    String   // "telegram" | "instagram"
  language    String   // "ru" | "kk" | "common"
  name        String
  enabled     Boolean  @default(true)
  isDefault   Boolean  @default(false)
  credentials String   // AES-256-GCM encrypted JSON
  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

model SocialMediaPublication {
  id          String   @id @default(uuid())
  articleId   String
  configId    String
  platform    String
  language    String
  status      String   // "pending" | "success" | "failed"
  externalId  String?
  externalUrl String?
  error       String?
  attempts    Int      @default(0)
  publishedAt DateTime?
  createdAt   DateTime @default(now())

  article     Article  @relation(fields: [articleId], references: [id])
  config      SocialMediaConfig @relation(fields: [configId], references: [id])

  @@unique([articleId, platform, language])  // idempotency
}
```

## Использование

```ts
import { publishArticle } from '@/lib/social/publisher';

await publishArticle({
  articleId: 'abc-123',
  platforms: ['telegram', 'instagram'],
  languages: ['ru', 'kk'],
});
```

Идемпотентен: повторный вызов с теми же параметрами → проверяется `existingSuccess`, дубль не шлётся.

## Env

```env
SOCIAL_ENCRYPTION_KEY=<64-hex-chars>   # openssl rand -hex 32
```

## Подводные камни

- **IPv4-forced для Telegram** — без этого на некоторых VPS retry-loop из-за IPv6 timeouts.
- **Instagram container** — между create и publish обязательное polling до `FINISHED`. Без этого получаем `MEDIA_NOT_READY`.
- **Reels** — если в job передан `videoUrl`, container создаётся как `media_type=REELS`, processing занимает 30-90 секунд.
- **Idempotency** через unique-constraint `(articleId, platform, language)` — гарантирует, что в БД физически нельзя записать второй success для той же тройки. Race-condition безопасен.
- **Encrypted credentials** — никогда не логировать в `console.log` сырой `config.credentials`. Только через `getDecryptedCredentials()` и сразу использовать.

## Что отсутствует (gap)

- **Facebook Pages** — нигде в репо нет; для extension добавить `facebook.ts` по образцу `instagram.ts` (Graph API).
- **VK API** — добавить `vkontakte.ts`.
- **X (Twitter) v2** — добавить `twitter.ts`.

См. [`playbooks/social-autopost.md`](../../playbooks/social-autopost.md) для пошаговой настройки.
