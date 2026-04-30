# dev-base

> Личная база разработчика: скилы, инструкции, промпты, шаблоны, плейбуки. Источник истины для всех проектов.

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Lang](https://img.shields.io/badge/lang-RU-orange)]()
[![Stack](https://img.shields.io/badge/stack-Next.js%2016%20·%20Solana%20·%20FastAPI-black)]()

## Зачем

Останавливать «изобретение колеса» в каждом новом проекте. Вместо того, чтобы каждый раз вспоминать, как должен выглядеть README, какой формат коммитов использовать, какой промпт работает для логотипа — лежит здесь, открыл, скопировал, адаптировал.

## Структура

```
dev-base/
├── skills/        # стандарты и инструкции (как делать репо, как писать ТЗ, как готовить релиз)
├── prompts/       # отлаженные промпты (логотип, ТЗ, ревью, архитектурный бриф)
├── playbooks/     # пошаговые сценарии (запустить хакатон, выкатить Plesk, восстановить БД)
├── modules/       # переиспользуемые куски кода/конфигов (next.config, ESLint, GH Actions)
├── templates/     # шаблоны документов (README, PR, Issue, CONTRIBUTING)
└── assets/        # схемы, скриншоты, лого
```

## Как пользоваться

1. **Новый проект** → взять `templates/README.template.md` и `skills/github-repo-standard.md` как чек-лист.
2. **Нужен промпт** → искать в `prompts/` прежде, чем писать с нуля.
3. **Похожая задача уже решалась** → искать в `playbooks/`.
4. **Сделал что-то полезное, что точно пригодится снова** → положить сюда, а не закапывать в проект.

## Текущий состав

### Skills
- [github-repo-standard.md](skills/github-repo-standard.md) — единый стандарт оформления GitHub-репозиториев

### Templates
- [README.template.md](templates/README.template.md) — каркас README по стандарту
- [PR.template.md](templates/PR.template.md) — шаблон pull request
- [ISSUE-bug.template.md](templates/ISSUE-bug.template.md) — шаблон bug-issue
- [ISSUE-feature.template.md](templates/ISSUE-feature.template.md) — шаблон feature-issue
- [conventional-commits.md](templates/conventional-commits.md) — шпаргалка по Conventional Commits на русском

### Prompts
- [logo-til-kural.md](prompts/logo-til-kural.md) — пример промпта на разработку логотипа (til-kural)

## Roadmap

- [x] v0.1 — стандарт GitHub-репо + базовые шаблоны
- [ ] v0.2 — плейбук «новый Solana/Colosseum проект за 1 час»
- [ ] v0.3 — модули `next.config`, `eslint.config`, GitHub Actions CI
- [ ] v0.4 — промпты для архитектурного брифа и code review
- [ ] v0.5 — плейбук Plesk + Hoster.kz деплой через FTP

## Лицензия

[MIT](LICENSE)
