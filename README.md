# dev-base

> Личная база разработчика: скилы, инструкции, промпты, шаблоны, плейбуки. Источник истины для всех проектов.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Lang](https://img.shields.io/badge/lang-RU-orange)]()
[![Stack](https://img.shields.io/badge/stack-Next.js%2016%20·%20Solana%20·%20FastAPI-black)]()

## Зачем

Останавливать «изобретение колеса» в каждом новом проекте. Открыл, скопировал, адаптировал — а не вспоминал «как там был CSP / SDR-промпт / Plesk FTP / sitemap для bilingual».

## Структура

```
dev-base/
├── skills/          # стандарты и инструкции (как делать репо, ТЗ, релиз)
├── prompts/         # отлаженные промпты (логотип, ТЗ, ревью, агенты)
├── playbooks/       # пошаговые сценарии (деплой, auth, SEO, scheduler)
├── modules/         # переиспользуемые куски кода/конфигов
│   ├── ai/          # quota-guard, agent-runtime, gemini-tool-use
│   ├── admin/       # AdminShell, AdminSidebar, EntityCrudTable
│   ├── auth/        # JWT, refresh-tokens, rate-limit (memory + PG)
│   ├── ci/          # GitHub Actions workflows
│   ├── editor/      # TipTap RichTextEditor + ResizableImage/Video
│   ├── analytics-{frontend,backend,dashboard}/
│   ├── notifications/  # Web Push
│   ├── ops/         # backup/restore/healthcheck/rotate-secrets
│   ├── scheduler/   # durable jobs + cron-tick
│   ├── scripts/     # ftp-uploader, bundle-size-checker
│   ├── seo/         # builders, JsonLd, sitemap/robots/manifest
│   └── social/      # Telegram + Instagram publisher
├── templates/       # README, PR, Issues, CLAUDE.md, next.config, SQL
└── assets/          # схемы, скриншоты (TBD)
```

## Текущий состав (v0.2)

### Skills
- [github-repo-standard.md](skills/github-repo-standard.md) — единый стандарт оформления GitHub-репо

### Prompts (8 шт)
- [kk-writing-check.md](prompts/kk-writing-check.md) — проверка письменного текста A1–C2 (kk/ru, JSON-output)
- [kk-exercises-cefr.md](prompts/kk-exercises-cefr.md) — генерация упражнений с rule_id и адаптивной сложностью
- [kk-teacher-chat.md](prompts/kk-teacher-chat.md) — RAG-учитель с тремя стилями (Абай / Байтұрсынұлы / Әуезов)
- [voice-sales-assistant.md](prompts/voice-sales-assistant.md) — голосовой Pain→Value→CTA консультант (Gemini Live)
- [sdr-whatsapp-lead.md](prompts/sdr-whatsapp-lead.md) — SDR-агент в WhatsApp (4-стадийная воронка)
- [multi-agent-cxo-suite.md](prompts/multi-agent-cxo-suite.md) — C-suite (CEO/CFO/CTO/COO/CMO/CLO/CDO/CPO)
- [admission-rag.md](prompts/admission-rag.md) — помощник приёмной комиссии (FAISS+Gemini)
- [ai-content-analysis.md](prompts/ai-content-analysis.md) — анализ редакторского контента (score+improved_*)
- [logo-til-kural.md](prompts/logo-til-kural.md) — пример промпта на разработку логотипа

### Playbooks (12 шт)
- [deploy-nextjs-plesk-ftp.md](playbooks/deploy-nextjs-plesk-ftp.md) — Plesk FTP для Next.js (Hoster.kz)
- [deploy-ghcr-watchtower.md](playbooks/deploy-ghcr-watchtower.md) — GHCR + Watchtower auto-deploy без SSH
- [nextjs-standalone-deploy-local.md](playbooks/nextjs-standalone-deploy-local.md) — локальный standalone-deploy на VPS
- [auth-jwt-refresh.md](playbooks/auth-jwt-refresh.md) — JWT auth + refresh-tokens kit (Edge-friendly)
- [ai-quota-guard.md](playbooks/ai-quota-guard.md) — никогда не выйти в платный тариф Gemini
- [build-multi-agent.md](playbooks/build-multi-agent.md) — multi-agent с Agent + AgentRun + snapshot
- [social-autopost.md](playbooks/social-autopost.md) — TG + IG автопубликация с idempotency
- [scheduler-cron.md](playbooks/scheduler-cron.md) — durable scheduler с DB-CAS jobs
- [seo-checklist.md](playbooks/seo-checklist.md) — SEO release checklist для Next.js 16
- [analytics-stack.md](playbooks/analytics-stack.md) — 3-уровневая (consent + event store + dashboard)
- [sql-migrations-style.md](playbooks/sql-migrations-style.md) — нумерованные idempotent SQL-миграции
- [nextjs16-csp-hardening.md](playbooks/nextjs16-csp-hardening.md) — CSP/HSTS/headers production
- [server-port-isolation.md](playbooks/server-port-isolation.md) — карта портов multi-tenant VPS

### Modules

| Папка | Что | README |
|---|---|---|
| `modules/admin/` | AdminShell + AdminSidebar (×2) + EntityCrudTable + DashboardStats | [README](modules/admin/README.md) |
| `modules/ai/` | quota-guard, gcp-monitoring, ai-client, agent-runtime, seed-agents-cxo, gemini-tool-use | — |
| `modules/auth/` | JWT (Node + Edge), refresh-tokens, rate-limit (memory + PG) | [README](modules/auth/README.md) |
| `modules/ci/` | deploy-{plesk-ftp,ghcr-watchtower}, secrets-scan, bundle-budget, a11y-axe, anchor-tests, db-backup | [README](modules/ci/README.md) |
| `modules/editor/` | RichTextEditor + ResizableImage/Video extensions + BilingualArticleForm + AISuggestionsPanel | [README](modules/editor/README.md) |
| `modules/analytics-frontend/` | Analytics.tsx (GA4+YM consent-gated) + CookieConsent + AnalyticsConsent | — |
| `modules/analytics-backend/` | event-route + summary-route (rate-limit + session cookie + whitelist) | — |
| `modules/analytics-dashboard/` | recharts: LineChart + FunnelChart + UTM-таблица | — |
| `modules/notifications/` | Web Push (VAPID) + email fallback на 404/410 | — |
| `modules/ops/` | pg-backup / pg-restore / healthcheck / rotate-secrets | [README](modules/ops/README.md) |
| `modules/scheduler/` | scheduler.ts (durable jobs) + api-cron-tick | — |
| `modules/scripts/` | ftp_upload_next.py + check-bundle-size.sh | — |
| `modules/seo/` | seo-builders + JsonLd + sitemap (×2) + robots + manifest + service-clusters | [README](modules/seo/README.md) |
| `modules/social/` | publisher + telegram + instagram + encryption + templates + types | [README](modules/social/README.md) |

### Templates
- [README.template.md](templates/README.template.md)
- [PR.template.md](templates/PR.template.md)
- [ISSUE-bug.template.md](templates/ISSUE-bug.template.md)
- [ISSUE-feature.template.md](templates/ISSUE-feature.template.md)
- [conventional-commits.md](templates/conventional-commits.md)
- [CLAUDE.md.template](templates/CLAUDE.md.template) — инструкция для Claude Code в новом проекте
- [next.config.production.ts](templates/next.config.production.ts) — production CSP/HSTS/standalone
- [scripts/deploy-local.sh](templates/scripts/deploy-local.sh) — локальный standalone-deploy
- [sql/000_init_template.sql](templates/sql/000_init_template.sql), [ai_generations.sql](templates/sql/ai_generations.sql), [refresh_tokens.sql](templates/sql/refresh_tokens.sql)

## Как пользоваться

1. **Новый проект** → взять `templates/README.template.md` + `skills/github-repo-standard.md` как чек-лист, плюс `templates/CLAUDE.md.template` для будущих сессий с Claude Code.
2. **Нужен deploy** → `playbooks/deploy-*.md`, выбрать вариант (GHCR / FTP / local).
3. **Нужна авторизация** → `playbooks/auth-jwt-refresh.md` + `modules/auth/`.
4. **Нужны соцсети** → `playbooks/social-autopost.md` + `modules/social/`.
5. **Нужен AI** → `playbooks/ai-quota-guard.md` ПЕРВЫМ (без него — банкротство), потом `playbooks/build-multi-agent.md`.
6. **Похожая задача уже решалась** → grep в `playbooks/` и `prompts/`.
7. **Сделал что-то полезное, что точно пригодится снова** → положить сюда (см. `CONTRIBUTING.md`).

## Roadmap

- [x] **v0.1** — стандарт GitHub-репо + базовые шаблоны
- [x] **v0.2** — wave-1 (deploy, auth, AI-quota, CI, SQL, CSP) + wave-2 (ops/notifications/CLAUDE template) + wave-3 (admin shell, TipTap editor, social publisher, SEO core, multi-agent runtime, analytics 3-tier) + 8 production-prompts
- [ ] **v0.3** — Facebook Pages / VK / X (Twitter) v2 publishers (gap — нигде не реализовано)
- [ ] **v0.4** — Email queue + IndexNow ping + GSC/YaWebmaster integration
- [ ] **v0.5** — Solana boilerplate (anchor + token + NFT escrow + presale)

## Стандарт коммитов

Conventional Commits с английским префиксом + русское описание. См. [conventional-commits.md](templates/conventional-commits.md).

## Лицензия

[MIT](LICENSE)
