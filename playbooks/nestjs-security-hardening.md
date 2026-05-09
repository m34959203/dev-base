# NestJS production security hardening — чек-лист

Playbook: что **обязательно** настроить перед публикацией NestJS API в production. Из боевого аудита AIMAK 2026-05-09 (commit `f9fbe9a`) — 7 критических находок security-аудита, все на одном проекте.

## Когда применять

- Запуск нового NestJS API в prod
- Аудит существующего проекта на безопасность
- После прохождения внешнего pentest — что закрыть

Не охватывает: SQL injection защиту (Prisma делает сама), file storage on S3 (отдельный playbook).

## Чек-лист (8 пунктов)

### 1. Helmet middleware

```ts
// main.ts
import helmet from 'helmet';

app.use(
  helmet({
    contentSecurityPolicy: process.env.NODE_ENV === 'production'
      ? {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
            imgSrc: ["'self'", 'data:', 'https:'],
            connectSrc: ["'self'", 'https:'],
          },
        }
      : false, // в dev отключено для удобства swagger-ui
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // если есть статика /uploads на другом origin
  }),
);
```

Что даёт: `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, скрывает `X-Powered-By: Express`, добавляет CSP.

⚠️ CSP может ломать сторонние виджеты (Yandex Direct, AdSense). Если используете — добавляйте конкретные домены в `scriptSrc`/`frameSrc`.

### 2. Throttler (rate-limiting)

```bash
pnpm add @nestjs/throttler
```

```ts
// app.module.ts
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 100 }]), // глобально 100/min IP
    // ... другие модули
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard }, // ДО JwtAuthGuard
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
```

Per-endpoint:

```ts
// auth.controller.ts
import { Throttle } from '@nestjs/throttler';

@Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 попыток login в минуту
@Post('login')
login(@Body() dto: LoginDto) { ... }
```

⚠️ Throttler v6 нюанс: `@Throttle()` не всегда ловит `400 ValidationPipe` errors (валидация срабатывает после throttler-guard в некоторых cases). Глобальный лимит 100/min работает гарантированно — он на каждый request к Express.

### 3. Setup/destructive endpoints под auth + ENV-gate

Часто проекты создают `/api/setup/initialize` / `reset-database` для удобства dev'а и забывают убрать `@Public()`:

```ts
// ❌ ОПАСНО — любой через интернет может DROP SCHEMA
@Public()
@Post('reset-database')
async resetDatabase() {
  await this.prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE;`);
  // ...
}

// ✅ Безопасно
@Controller('setup')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiBearerAuth()
export class SetupController {
  @Post('reset-database')
  async resetDatabase() {
    // Дополнительный flag — даже admin не должен случайно нажать в prod
    if (process.env.NODE_ENV === 'production' &&
        process.env.ALLOW_RESET_DATABASE !== 'true') {
      return { success: false, message: 'Заблокировано в prod' };
    }
    await this.prisma.$executeRawUnsafe(`DROP SCHEMA public CASCADE;`);
  }
}
```

### 4. Bootstrap admin через ENV (не hardcoded)

```ts
// ❌ ОПАСНО — admin123 в git history навсегда
const hashedPassword = await bcrypt.hash('admin123', 10);
await this.prisma.user.create({
  data: { email: 'admin@example.com', password: hashedPassword, role: 'ADMIN' },
});

// ✅
const adminEmail = process.env.BOOTSTRAP_ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;

if (!adminPassword) {
  this.logger.warn('BOOTSTRAP_ADMIN_PASSWORD не задан — bootstrap admin НЕ создан');
  return;
}

const hashedPassword = await bcrypt.hash(adminPassword, 10);
// Existing user — только promote, password unchanged
const existing = await this.prisma.user.findUnique({ where: { email: adminEmail } });
if (existing) {
  await this.prisma.user.update({
    where: { id: existing.id },
    data: { role: 'ADMIN' }, // НЕ перезаписываем password
  });
}
```

В `.env.example` обязательно написать комментарий, что в prod `BOOTSTRAP_ADMIN_PASSWORD` обязателен.

### 5. Multer — MIME type whitelist (не только extension)

```ts
// ❌ Только extension — '.exe' переименованный в '.mp4' пройдёт
fileFilter: (req, file, cb) => {
  if (!file.originalname.match(/\.(jpg|png)$/i)) {
    return cb(new Error('Only images'), false);
  }
  cb(null, true);
}

// ✅ Pair-check: extension + MIME
const ALLOWED_IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

fileFilter: (req, file, cb) => {
  if (!file.originalname.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
    return cb(new Error('Bad extension'), false);
  }
  if (!ALLOWED_IMAGE_MIME.has(file.mimetype)) {
    return cb(new Error(`Invalid MIME: ${file.mimetype}`), false);
  }
  cb(null, true);
}
```

⚠️ Это всё ещё не идеально — клиент отправляет MIME, может подделать. Реальная защита от malware → отдельный clamav scan процесс. Для общей санитизации pair-check достаточно.

### 6. CORS — НЕ полагаться на `if (!origin) block`

```ts
// ❌ Не работает: Express CORS пропускает no-origin как not-cross-origin
app.enableCors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, false); // curl/Postman всё равно проходят
    // ...
  },
});
```

Реальная защита от curl/Postman/server-to-server — **JwtAuthGuard глобально** + throttler + fail2ban на nginx. CORS — защита **браузера**, не API.

### 7. Swagger — выключить в production

```ts
// ❌ Все endpoints + DTO + примеры открыты публично
const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api/docs', app, document);

// ✅
if (process.env.NODE_ENV !== 'production') {
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, document);
}
```

### 8. Prisma SQL log — НЕ info в production

```ts
// ❌ — каждый SQL с email/password в stdout
super({
  log: [
    { emit: 'stdout', level: 'info' },
    { emit: 'stdout', level: 'warn' },
    { emit: 'stdout', level: 'error' },
  ],
});

// ✅
const isProd = process.env.NODE_ENV === 'production';
super({
  log: isProd
    ? [{ emit: 'stdout', level: 'error' }]
    : [
        { emit: 'stdout', level: 'info' },
        { emit: 'stdout', level: 'warn' },
        { emit: 'stdout', level: 'error' },
      ],
});
```

PII (emails в WHERE, passwords в bcrypt-input) попадают в `api-out.log`, ротируется через pm2-logrotate без шифрования. Если оператор скомпрометирован — все user emails слиты.

## Бонус: web

### DOMPurify для user HTML

Если frontend рендерит контент через `dangerouslySetInnerHTML` (например реклама с `customHtml`):

```bash
pnpm add isomorphic-dompurify
```

```tsx
import DOMPurify from 'isomorphic-dompurify';

const cleanHtml = DOMPurify.sanitize(userHtml, {
  ALLOWED_TAGS: ['a', 'b', 'br', 'div', 'em', 'h1', 'h2', 'i', 'img', 'p', 'span', 'strong'],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'title', 'style', 'class'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: ['script', 'style', 'iframe', 'object', 'embed', 'link', 'meta'],
  FORBID_ATTR: ['onerror', 'onclick', 'onload', 'onmouseover'],
});

return <div dangerouslySetInnerHTML={{ __html: cleanHtml }} />;
```

`isomorphic-dompurify` работает и в SSR, и в CSR без хака window.

### Webhook signature — без `JSON.stringify` fallback

```ts
// ❌ Если rawBody потерялся, JSON.stringify(body) даст другую byte-stream
const rawBody = req.rawBody?.toString() || JSON.stringify(body);
this.verifySignature(rawBody, signature, secret);

// ✅
const rawBody = req.rawBody?.toString();
if (!rawBody) {
  return res.status(400).send('Missing rawBody — signature verification impossible');
}
```

Также убедиться что `NestFactory.create(AppModule, { rawBody: true })` включён.

## Финальный smoke-чек после applying

```bash
# 1. Helmet headers
curl -sI http://api.example.com/api/health | grep -iE "(x-frame|x-content|x-powered|content-security)"
# Ожидаем: X-Frame-Options, X-Content-Type-Options, CSP. X-Powered-By НЕТ.

# 2. Setup endpoints под auth
curl -s -o /dev/null -w "%{http_code}\n" -X POST http://api/api/setup/check
# Ожидаем: 401

# 3. Swagger в prod закрыт
curl -s -o /dev/null -w "%{http_code}\n" http://api/api/docs
# Ожидаем: 404

# 4. Throttler global limit (101 req за минуту)
for i in {1..105}; do curl -s -o /dev/null -w "%{http_code}\n" http://api/api/health; done | sort | uniq -c
# Ожидаем: ~100x 200, остальные 429
```

## Связанные плейбуки

- [auth-jwt-refresh.md](auth-jwt-refresh.md) — JWT auth + refresh-tokens
- [ai-quota-guard.md](ai-quota-guard.md) — pre-flight USD-cap (защита бюджета AI)
- [nodejs-prod-overload-recovery.md](nodejs-prod-overload-recovery.md) — диагностика перегрузки 2GB VPS

## Источник

AIMAK (aimaqaqshamy.kz), commit `f9fbe9a` от 2026-05-09. Полный аудит дал ~23 находки, 7 критических security — все закрыты этим playbook'ом за один rebuild + ~40 минут работы.
