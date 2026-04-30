# Playbook: построить multi-agent систему (Agent + AgentRun + snapshot context)

**Цель:** конфигурируемые через админку AI-агенты, каждый со своим system prompt, ролью и контекстом. Каждый запуск логируется, показывается стоимость и время.

**Источник:** technokod `src/lib/agents.ts` + `prisma/seed-agents.ts` (8-агентный C-suite production).

## Архитектура

```
Agent table  ←──── админка /admin/agents
  ├─ slug, title, role, focus, color
  ├─ system_prompt (полный текст)
  ├─ model (gemini-2.5-flash / claude-sonnet)
  └─ enabled

User → /admin/agents/<slug>/run (UI)
       │
       └─→ runAgent({slug, userMessage, context}) [src/lib/agents.ts]
           │
           ├─ buildSnapshotContext() — живой контекст компании:
           │    leads (последние 20), AI-расходы за неделю,
           │    social-publications, WhatsApp-лента, living doc
           │
           ├─ aiComplete({ system: prompt+snapshot, prompt: userMessage })
           │    → Gemini → fallback OpenRouter
           │    → assertQuota(model) перед вызовом
           │
           └─ AgentRun.create() — лог: agent, user, message, response,
                cost_usd, duration_ms, status, snapshot
```

## Файлы

- [`modules/ai/agent-runtime.ts`](../modules/ai/agent-runtime.ts) — `runAgent({slug, userMessage, context})`, `buildSnapshotContext()`, `loadAgent(slug)`.
- [`modules/ai/seed-agents-cxo.ts`](../modules/ai/seed-agents-cxo.ts) — seed для C-suite (CEO/CFO/CTO/COO/CMO/CLO/CDO/CPO + SDR Тимур).
- [`modules/ai/ai-client.ts`](../modules/ai/ai-client.ts) — `aiComplete({...})` с Gemini→OpenRouter fallback (см. ai-quota-guard playbook).
- [`modules/ai/gemini-tool-use.ts`](../modules/ai/gemini-tool-use.ts) — паттерн **function-calling**: `chatWithBaubekAIWithTools` + `checkAvailabilityToolDeclaration` + `continueChatWithToolResult`. Для случаев, когда агент должен **искать в БД / звать API** в процессе ответа.
- [`prompts/multi-agent-cxo-suite.md`](../prompts/multi-agent-cxo-suite.md) — все 8 system prompts с шаблоном замены `COMPANY_CONTEXT`.

## Schema (Prisma)

```prisma
model Agent {
  id           String   @id @default(uuid())
  slug         String   @unique
  title        String
  role         String
  focus        String
  color        String   @default("#6366f1")
  systemPrompt String   @db.Text
  model        String   @default("gemini-2.5-flash")
  enabled      Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  runs         AgentRun[]
}

model AgentRun {
  id              String   @id @default(uuid())
  agentId         String
  userId          String?
  userMessage     String   @db.Text
  response        String?  @db.Text
  contextSnapshot Json?
  costUsd         Float?
  durationMs      Int?
  status          String   @default("pending")  // pending | success | failed
  error           String?
  createdAt       DateTime @default(now())

  agent           Agent    @relation(fields: [agentId], references: [id])

  @@index([agentId, createdAt(sort: Desc)])
  @@index([userId, createdAt(sort: Desc)])
}
```

## Установка

### 1. Schema migrate

```bash
npx prisma migrate dev --name add_agents
```

### 2. Файлы

```bash
mkdir -p src/lib prisma
cp <dev-base>/modules/ai/agent-runtime.ts src/lib/agents.ts
cp <dev-base>/modules/ai/seed-agents-cxo.ts prisma/seed-agents.ts
cp <dev-base>/modules/ai/ai-client.ts src/lib/ai.ts
cp <dev-base>/modules/ai/quota-guard.ts src/lib/ai-quota.ts
```

### 3. Naполнить C-suite (или свои)

В `seed-agents-cxo.ts` обновить `COMPANY_CONTEXT` и `PROMOTION_MANDATE` константы под свой бизнес. Затем:

```bash
npx ts-node prisma/seed-agents.ts
```

Будут созданы 9 агентов (`ceo`, `cfo`, `cto`, `coo`, `cmo`, `clo`, `cdo`, `cpo`, `sdr`).

### 4. UI

В `app/(admin)/admin/agents/`:
- `page.tsx` — список агентов (карточки с цветами).
- `[slug]/page.tsx` — чат с конкретным агентом (история runs).
- `/api/admin/agents/[slug]/run/route.ts` — POST endpoint:

```ts
import { runAgent } from '@/lib/agents';

export async function POST(req: Request, { params }: { params: Promise<{ slug: string }>}) {
  const { slug } = await params;
  const { message } = await req.json();
  const user = await requireRole(['admin']);
  const result = await runAgent({ slug, userMessage: message, userId: user.userId });
  return Response.json(result);
}
```

## Snapshot context — что инжектится в каждый запуск

`buildSnapshotContext()` читает живые данные компании:

```ts
{
  leads: [/* последние 20 */],
  aiSpend: { day: 0.42, week: 2.31 },     // в USD
  socialPubs: [/* последние 10 публикаций */],
  whatsappRecent: [/* последние 30 сообщений */],
  livingDoc: { /* структурированные секции */ },
  metricsToday: { /* page views, leads count */ }
}
```

Это даёт агенту **полный** контекст без необходимости задавать уточняющие вопросы. CFO видит `aiSpend`, CMO — `socialPubs`, CDO — `metricsToday` etc.

**Каждая роль фильтрует snapshot:** в `agent-runtime.ts` есть `pickContextForAgent(slug, snapshot)` — чтобы CFO не получал WhatsApp-ленту, а CMO — детали AI-расходов.

## Tool-use vs static context

### Static (текущий C-suite)

System prompt + snapshot context **зафиксированы в момент запуска**. Агент работает только с ними. Простой, дешёвый, предсказуемый.

### Tool-use (smart-library-cbs)

Агент в процессе ответа может **звать функции**: проверить наличие книги в БД, поискать события на дату, посчитать расход AI. Сложнее, но мощнее — для интерактивных ассистентов.

См. [`modules/ai/gemini-tool-use.ts`](../modules/ai/gemini-tool-use.ts) — `checkAvailabilityToolDeclaration` пример. Loop:

```ts
1. user → AI (с tool declarations)
2. AI → response с functionCall? 
3. → выполнить функцию → результат → continueChatWithToolResult()
4. AI → final ответ (или ещё functionCall — лопится до 3 уровней)
```

## Подводные камни

- **System prompt длиной > 8K** — Gemini Flash начинает терять детали в середине. Делить на блоки или короче.
- **AgentRun storage** — каждый запуск пишется в БД; за месяц активного использования таблица распухает. Партиционируй по `created_at` или archive в S3 после 30 дней.
- **Cost tracking** — обязательно `costUsd` пишется (через AIGeneration логирование в `aiComplete`). Иначе CFO-агент ничего не покажет.
- **`focus` поле** — короткая (≤200 символов) подсказка "когда я нужен". Используется в UI-каталоге `/admin/agents`.
- **Концентрация на промпте, не коде** — большую часть value делает текст system_prompt. Меняй его в админке (DB-driven), не в коде. Это позволяет тюнить продакшн без релиза.

## C-suite vs single-agent vs FSM

| Подход | Когда |
|---|---|
| **Single-agent** (один system prompt, один runner) | MVP, чат-бот по базе знаний, простой ассистент |
| **Multi-agent C-suite** (этот) | Стратегические запросы, разные углы анализа, мульти-роль |
| **FSM bot** (research-bot) | Сложный пользовательский диалог с состояниями (анкета, опрос, заказ) |
| **Tool-use** (smart-library-cbs) | Интерактивный поиск/действие, а не диалог |
| **RAG** (admission-bot) | Ответы по большой базе документов |

Можно комбинировать: C-suite использует tool-use внутри (CDO зовёт SQL-функцию для метрик). Усложнение → усложняй, когда упёрся в простой подход.

## Связанные

- [`prompts/multi-agent-cxo-suite.md`](../prompts/multi-agent-cxo-suite.md) — все 8 prompts с шаблоном.
- [`prompts/sdr-whatsapp-lead.md`](../prompts/sdr-whatsapp-lead.md) — SDR Тимур.
- [`prompts/admission-rag.md`](../prompts/admission-rag.md) — RAG-паттерн.
- [`playbooks/ai-quota-guard.md`](ai-quota-guard.md) — чтобы не выйти в платный тариф.
