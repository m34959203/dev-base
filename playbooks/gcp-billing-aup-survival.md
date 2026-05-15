# Playbook: GCP billing / AUP survival для соло-проектов

**Цель:** не получить **suspended project** или **списания в $200+** по ошибке. Чек-лист действий до/после создания GCP проекта с Gemini.

**Источник:** инцидент 2026-05-15 — billing `01611D-...` приостановлен по AUP за «один Gemini-ключ на 7 production-доменов», параллельно trial $295 истёк и Google автоматически перевёл другой billing в paid tier. Подробности в `feedback_gcp_aup_suspension.md` и `feedback_gcp_trial_auto_upgrade.md`.

## Базовые правила

### 1. Один проект ≠ один ключ. **Один продукт = один проект = один ключ.**

❌ Anti-pattern: общий ключ `AIzaSyAD...` в 6+ production `.env`-ах (technokod / til-kural / dvorets / smart-kids / smart-library / brief-ai).

**Почему плохо:**
- Google антифрод видит «один ключ — много production-доменов с разнообразным трафиком» = **API key reselling**.
- AUP-флаг прилетает на весь billing account → все проекты в этом billing'е приостановлены **одномоментно**.
- При утечке одного `.env` — выгорают все проекты.

✅ Правильно: каждое production-приложение → свой GCP project → свой ключ → свой budget cap.

### 2. **Trial $300 НЕ защита от списаний — если карта привязана.**

Раньше думали: «карта привязана как опциональная для регистрации, но без явного `Upgrade to paid` останется free/disabled». **НЕ ТАК.**

Реальное поведение Google (проверено 2026-05-15):
- Trial истёк → Google **автоматически** переводит billing в paid tier
- Карта (если привязана) **начинает списываться** без явного действия
- API не возвращает `403 BILLING_DISABLED`, продолжает работать с `serviceTier: "standard"` (paid)

**Защита от auto-upgrade:**
1. **Remove card до конца trial** (`Billing → Payment methods → Remove`). После — API уходит в `403`, карта не светится.
2. **Виртуальная карта** Wise/Revolut с лимитом $5 — можно безболезненно заблочить.
3. **Никогда не привязывать боевую Visa к expermimental проекту.**

Проверка какой tier сейчас:
```bash
curl -sS "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=AIzaSy..." \
  -H "Content-Type: application/json" \
  -d '{"contents":[{"parts":[{"text":"ping"}]}]}' | jq '.usageMetadata.serviceTier'
# "free" → бесплатно
# "standard" → платно ⚠️
```

### 3. **AUP-приостановка ≠ billing-проблема. Оплата не разблокирует.**

Если получил письмо:
> «A potential violation of our Acceptable Use Policy has been detected for multiple projects you own»

**НЕ платить.** Это анти-злоупотребление, не просрочка. Действия:
1. Click «FIX NOW» только для просмотра deталей (не платить).
2. Подать апелляцию: [Cloud Support → Billing → Account suspension](https://support.google.com/cloud/answer/9110800).
   Формулировка: solo developer, educational/internal projects, shared key for cost simplicity (not reselling), ready to isolate per-project.
3. Параллельно — **миграция**:
   - Создать новый GCP project (другой billing account, желательно без карты)
   - Перевести production-сервисы на новый ключ
   - Старый billing → Remove Card → forget

## Чек-лист при создании нового GCP проекта

```
□ Создан в правильном Google-аккаунте (не путать `Mdtech@bk.ru` и `dastanovabdolla@gmail.com`)
□ Привязан billing account БЕЗ карты (или с виртуалкой $5-лимит)
□ Включены ТОЛЬКО нужные APIs (не enable all)
□ Service account создан с минимальными ролями (aiplatform.user, не roles/owner)
□ API key: bound to service account, restrictions = только нужный API
□ Budget alert: $5/мес + ALL emails ($5/$10/$20/$50)
□ В коде: assertUsdBudget pre-flight (см. ai-quota-guard.md)
□ Один project = один production-домен (см. правило 1)
□ Logging: каждый AI call → DB row {project, model, tokens_in, tokens_out, cost_estimate}
```

## Rotation процедура (если ключ скомпрометирован)

```bash
# 1. Найти где используется ключ — ВО ВСЕХ местах
grep -rln "AIzaSy<prefix>" /home/ubuntu --include="*.env*" --include="*.json" | grep -v node_modules
for c in $(docker ps --format "{{.Names}}"); do
  docker inspect "$c" 2>/dev/null | grep -q "AIzaSy<prefix>" && echo "$c"
done

# 2. Создать новый ключ ДО удаления старого (избежать downtime)
gcloud alpha services api-keys create --display-name="<name>-rotated-<date>" \
  --api-target=service=generativelanguage.googleapis.com \
  --project=<project>

# 3. Заменить во всех найденных .env-ах
sed -i "s/AIzaSy<old>/AIzaSy<new>/g" <found_files>

# 4. Restart всех контейнеров где env пробрасывался
docker compose restart <services>

# 5. Удалить старый ключ
gcloud alpha services api-keys delete projects/<num>/locations/global/keys/<uid> --project=<project>
```

## Vertex AI vs Gemini Developer API — billing разный

⚠️ **Не путать:**

| Стек | Endpoint | Billing | $300 GCP trial |
|---|---|---|---|
| Gemini Developer API | `generativelanguage.googleapis.com` | AI Studio prepayment ($) | ❌ НЕ покрывает |
| Vertex AI | `aiplatform.googleapis.com` | GCP billing | ✅ Покрывает |

Если на новом проекте Gemini Developer API возвращает `429 RESOURCE_EXHAUSTED — prepayment depleted`:
- Это значит **GCP trial не работает** для Gemini Dev API
- Либо: добавить prepayment в AI Studio
- Либо: мигрировать на Vertex AI (см. `vertex-ai-live-ws-proxy.md`)

## Free tier альтернативы (без карты)

Если совсем без денег:
- **Gemini Developer API классические ключи** через AI Studio (без service account binding): **1500 req/day** на проект, gemini-2.5-flash. Без карты, без prepayment.
  - Но: новые ключи требуют SA binding → возможно фазится.
- **Groq** llama-3.3-70b: 30 req/min, 100k tokens/day. Без карты вообще.
- **OpenRouter** DeepSeek: 200 req/day. Без карты.
- **Эти три комбинировать в multi-provider fallback** (см. `ai-multi-provider-fallback.md` — TBD).

## Связанные playbooks
- `ai-quota-guard.md` — USD-cap pre-flight в коде
- `ai-usage-logging.md` — DB-лог каждого AI вызова
- `vertex-ai-live-ws-proxy.md` — миграция на Vertex Live
