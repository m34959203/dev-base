# Cloudflare перед SSR-сайтом (Next.js / NestJS)

Playbook: подключение бесплатного Cloudflare к сайту, настройка кэша HTML/static и bypass для API/админки. Эффект для AIMAK — снижение CPU API/Web на 40-60% за счёт кэша на edge и резки ботов.

## Шаг 1. Регистрация и подключение домена (5 мин)

1. https://dash.cloudflare.com/sign-up — создать бесплатный аккаунт.
2. Dashboard → **Add a Site** → ввести домен (например `aimaqaqshamy.kz`) → Continue.
3. Выбрать **Free** план → Continue.
4. CF автоматически просканирует существующие DNS у регистратора (PS.KZ). Важно проверить:
   - **A** `aimaqaqshamy.kz` → IP сервера (`82.115.49.251`) — должна быть. Proxied (оранжевое облачко) **ON**.
   - **A** или CNAME `www` → тот же IP / apex — должна быть. Proxied **ON**.
   - Если каких-то DNS-записей нет — добавить вручную в этом же шаге.
5. Continue → CF выдаст **2 свои NS-сервера** вида `xxx.ns.cloudflare.com` и `yyy.ns.cloudflare.com`. Скопировать.

## Шаг 2. Сменить NS у регистратора (5 мин)

Для PS.KZ (характерные шаги):
1. https://www.ps.kz → Личный кабинет → раздел **Доменные имена**.
2. Открыть `aimaqaqshamy.kz` → **NS-серверы**.
3. Удалить `ns1/ns2/ns3.ps.kz`. Вписать 2 NS от Cloudflare.
4. Сохранить.

Активация занимает 10 мин — 24 ч (обычно в KZ ~1-2 ч). На дашборде CF будет «Pending Nameserver Update» → станет «Active». Письмо придёт на email аккаунта CF.

## Шаг 3. Базовые настройки SSL/TLS (после активации, 2 мин)

В CF Dashboard → выбрать домен:

- **SSL/TLS** → Overview → mode **Full (strict)**. На сервере уже есть Let's Encrypt-сертификат (certbot), CF будет общаться с ним по HTTPS. Mode «Flexible» **не использовать** — CF будет ходить на сервер по HTTP, повышается риск.
- **SSL/TLS** → Edge Certificates:
  - **Always Use HTTPS** — ON
  - **Automatic HTTPS Rewrites** — ON
  - **Minimum TLS Version** — TLS 1.2 (или 1.3)

## Шаг 4. Speed настройки (1 мин)

CF Dashboard → Speed → Optimization:
- ~~**Auto Minify**~~ — **убрано в августе 2024**, теперь делается через Compression Rules. Отдельного тоггла больше нет, не искать.
- ~~**Brotli**~~ — включён по умолчанию для всех Free-зон, тоггла нет.
- **Early Hints** — ON (если есть в твоём плане).

То есть на новых зонах в этот шаг по факту делать нечего — всё уже on by default. Speed → Optimization можно пропускать.

## Шаг 5. Cache Rules — главное (5 мин)

CF Dashboard → Caching → **Cache Rules** → Create rule. Создать **3 правила в указанном порядке** (порядок важен — первое совпавшее побеждает):

### Rule 1: «Bypass admin and API»

- Name: `Bypass admin and API`
- If incoming requests match (между блоками — **OR**):
  - `URI Path` `starts with` `/api/`
  - OR `URI Path` `starts with` `/admin`
  - OR `URI Path` `starts with` `/login`
- Then:
  - Cache eligibility: **Bypass cache** (это отдельный переключатель, не «Eligible with TTL=0»).

⚠️ Проверка после сохранения: `curl -sSI https://домен/api/<любой_endpoint> | grep cf-cache-status` должно вернуть `BYPASS`. Если вернуло `MISS` или `DYNAMIC` — правило не сработало:
- проверить что между условиями стоит **OR**, а не AND;
- проверить что Rule 1 **первое в списке** правил (drag-and-drop);
- проверить что выбран именно Bypass cache, а не Eligible for cache.

### Rule 2: «Cache static assets»

- Name: `Cache static assets`
- If: `URI Path` matches regex: `\.(jpg|jpeg|png|webp|avif|gif|svg|ico|woff2?|ttf|css|js|map)$`
- Then:
  - Cache eligibility: **Eligible for cache**
  - Edge TTL: радио-кнопка **«Override origin and use this TTL»** → `1 month`. Если выбрать «Use cache rule TTL only when origin doesn't specify» — Next отдаёт `max-age=14400` для статики, и CF будет уважать 4 часа вместо месяца.
  - Browser TTL: `1 day`.

### Rule 3: «Cache HTML pages»

- Name: `Cache HTML pages`
- If: `URI Path` `starts with` `/` (то есть всё, что не поймали Rule 1 и Rule 2).
- Then:
  - Cache eligibility: **Eligible for cache**
  - Edge TTL: **Override origin** → `1 minute`
  - Browser TTL: `30 seconds`

Дополнительное условие на cookie (`Cookie does not contain "next-auth"` или аналог) добавлять **только если** на сайте есть аутентификация для обычных пользователей (комментарии, личный кабинет). Для чисто-публичного сайта с админкой по `/admin` это не нужно — Rule 1 уже исключает админку.

⚠️ Важные замечания:
- На сайтах с i18n корень `/` обычно отдаёт **307 redirect** на дефолтную локаль (`/kk`, `/ru`). Редиректы CF по умолчанию **не кэширует** — это норма, они быстрые. Тестировать кэш надо на `/<locale>`, не на `/`. На `/kk` ответ должен быть `cf-cache-status: HIT` со 2-го запроса (или с 1-го, если кто-то раньше успел прогреть).
- Vary-заголовки от Next.js (`vary: RSC, Next-Router-State-Tree, Next-Router-Prefetch`) **не ломают кэш в современных Cache Rules** — CF их корректно учитывает. Не паниковать при их виде.
- Cache HIT работает в синергии с ISR — если ISR ещё не успел перерендерить, CF отдаёт свой кэш.

## Шаг 6. Security настройки (1 мин)

- **Security** → Settings → Security Level — `Medium` (default норм).
- **Security** → Bots → **Bot Fight Mode** — ON (Free). Это режет mass-crawlers, которые сейчас грузят `findBySlug` на статьях.
- **Firewall** (если хочется) → Custom Rules → создать правило, блокирующее IP, которые делают >100 RPS — пока не обязательно.

## Шаг 7. Проверка

После активации NS:

```bash
DOMAIN=aimaqaqshamy.kz
LOCALE_PATH=/kk     # дефолтная локаль (на сайтах без i18n — оставить /)

# 1) NS пропагировались?
for r in 8.8.8.8 1.1.1.1 9.9.9.9 208.67.222.222 77.88.8.8; do
  printf "%-15s: " "$r"; dig @$r +short NS "$DOMAIN" | tr '\n' ' '; echo
done
# Если хотя бы один резолвер показывает CF NS — зона уже частично активна.

# 2) A-запись резолвится в CF (104.x / 172.67.x / 188.114.x)?
dig +short A "$DOMAIN"

# 3) Заголовки — должен быть cf-ray, server: cloudflare
curl -sSI "https://$DOMAIN/" | grep -iE "^(cf-|server):"

# 4) HTML-кэш HIT? (тестируем на локали, не на корне — корень обычно 307)
curl -s -o /dev/null "https://$DOMAIN$LOCALE_PATH"   # прогрев
sleep 1
curl -sSI "https://$DOMAIN$LOCALE_PATH" | grep -i cf-cache-status   # ожидаем HIT

# 5) Static (Rule 2)
curl -sSI "https://$DOMAIN/favicon.ico?v=$(date +%s)" | grep -i cf-cache-status   # MISS первый раз
curl -sSI "https://$DOMAIN/favicon.ico?v=$(date +%s)" | grep -i cf-cache-status   # HIT (с тем же ts!)

# 6) API Bypass (Rule 1) — КРИТИЧНО, проверить обязательно
curl -sSI "https://$DOMAIN/api/<любой_публичный_endpoint>" | grep -i cf-cache-status   # ожидаем BYPASS
# Если вернулось MISS / DYNAMIC — править Rule 1 (см. Шаг 5, Rule 1).
```

Затем замерить нагрузку на сервере: `pidstat -u 1 30` для api/web процессов — должна упасть на 30-60%.

## Что делать если что-то сломалось

- **Сайт не открывается** — на CF в Cache Rules временно отключить «Cache HTML», или поставить SSL/TLS mode в `Full` (без strict).
- **Админка глючит / залипает в выходе** — проверить что cookie auth не попадает в кэш (Rule 3 должно его исключать). Если auth-cookie называется иначе — поправить в правиле.
- **Изображения не обновляются** — Cache Rules → Purge Cache → Purge Everything. Или поставить TTL для изображений короче.
- **Откат**: вернуть NS в PS.KZ обратно на `ns1/2/3.ps.kz` — пропагация 10-30 мин и сайт снова идёт мимо CF.

## Что НЕ делать

- **Не включать «Cache Everything» глобально** через Page Rules — кэш админки и API сломает аутентификацию и создаст утечки личных данных.
- **Не удалять Let's Encrypt сертификат** на сервере — CF в режиме Full (strict) требует валидный cert.
- **Не активировать Cloudflare Workers/R2/etc на бесплатном плане** случайно — там лимиты, можно случайно превысить.
