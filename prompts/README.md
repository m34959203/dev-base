# prompts/

Отлаженные промпты для LLM/AI-генераторов. Каждый файл — копи-пейст-готовый промпт с указанием модели, температуры, контракта input/output и блоком «как переиспользовать».

## Каталог

### Образовательные AI-боты (казахский язык)
- [kk-writing-check.md](kk-writing-check.md) — проверка письменного текста A1–C2, двуязычная (kk/ru), JSON-output с corrections + score + feedback. По жанрам: free / letter / essay / application / sms / congrats.
- [kk-exercises-cefr.md](kk-exercises-cefr.md) — генерация 5 упражнений по CEFR-уровню, адаптивная сложность от avg_score, привязка к rule_id из каталога 21+ правил.
- [kk-teacher-chat.md](kk-teacher-chat.md) — RAG-учитель с тремя стилями наставников (Абай / Байтұрсынұлы / Әуезов), CEFR-шкала, kk/ru.

### Маркетинг и продажи (Technokod-стек)
- [voice-sales-assistant.md](voice-sales-assistant.md) — голосовой консультант через Gemini Live native-audio (Pain → Value → CTA), kk/ru.
- [sdr-whatsapp-lead.md](sdr-whatsapp-lead.md) — SDR-агент в WhatsApp: 4 стадии воронки + close на звонок, JSON-output для оркестратора, обработка возражений.
- [multi-agent-cxo-suite.md](multi-agent-cxo-suite.md) — C-suite (CEO/CFO/CTO/COO/CMO/CLO/CDO/CPO) на едином COMPANY_CONTEXT для мульти-агентного стратегического чата.

### RAG-боты
- [admission-rag.md](admission-rag.md) — помощник приёмной комиссии вуза на FAISS+Gemini, поиск по официальным документам.

### Дизайн / визуал
- [logo-til-kural.md](logo-til-kural.md) — пример промпта на разработку логотипа (краткий + развёрнутый бриф).

## Правила пополнения

1. Имя файла — `<сценарий>-<контекст>.md` (kebab-case).
2. Шапка: «модель + температура + цель» одной строкой, потом полный промпт.
3. В конце — блок «**Как переиспользовать**» с шаблоном замены project-specific полей.
4. Если промпт работает в паре с кодом (rule-каталог, RAG-контекст) — указать связку.
