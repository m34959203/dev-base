# modules/ci/

GitHub Actions workflows и related scripts. Каждый — drop-in для нового проекта.

## Файлы

### Deploy

- [`deploy-plesk-ftp.yml`](deploy-plesk-ftp.yml) + [`../scripts/ftp_upload_next.py`](../scripts/ftp_upload_next.py) — Plesk FTP deploy для Next.js (Hoster.kz). См. [`playbooks/deploy-nextjs-plesk-ftp.md`](../../playbooks/deploy-nextjs-plesk-ftp.md).
- [`deploy-ghcr-watchtower.yml`](deploy-ghcr-watchtower.yml) — GHCR + Watchtower auto-deploy без SSH. См. [`playbooks/deploy-ghcr-watchtower.md`](../../playbooks/deploy-ghcr-watchtower.md).

### Security gates

- [`secrets-scan.yml`](secrets-scan.yml) — gitleaks scan на каждый push/PR. **Обязателен** во всех проектах после случая с Groq-ключом в hackatonskiiiy. Использует [`.gitleaks.toml`](.gitleaks.toml) для tuning ignore-правил.
- [`bundle-budget.yml`](bundle-budget.yml) + [`../scripts/check-bundle-size.sh`](../scripts/check-bundle-size.sh) — бюджет размера First Load JS (по умолчанию 300KB). Падает PR если превышен. Комментирует в PR разницу.
- [`a11y-axe.yml`](a11y-axe.yml) — Playwright + axe-core E2E прогон главных страниц. Лошадиная норма для public-сайтов.

### Solana

- [`anchor-tests.yml`](anchor-tests.yml) — Anchor 0.32.1 + Solana 3.1.13 + кэш для on-chain test-suite. Для `programs/`-проектов.

## Обязательный набор для нового публичного проекта

```
.github/workflows/
├── secrets-scan.yml         ← MUST
├── bundle-budget.yml        ← MUST для public Next.js  
├── a11y-axe.yml             ← MUST для пользовательских интерфейсов
└── deploy-{ghcr,plesk}.yml  ← один по выбору
```

Опционально: `anchor-tests.yml` (Solana), `db-backup.yml` (см. wave 2).

## Установка

Каждый workflow — самодостаточный, копировать в `.github/workflows/` целевого проекта. Адаптация описана в шапке каждого файла.
