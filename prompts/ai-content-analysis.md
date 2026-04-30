# Промпт: AI-анализ редакторского контента (score + suggestions + improved_title)

**Модель:** `gemini-2.5-flash` · **purpose:** analyze-content
**Контракт:** строго JSON, без code-fence (но клиент стрипает на всякий случай).
**Источник:** til-kural `src/app/api/ai/analyze-content/route.ts`

## Зачем

При публикации статьи редактор нажимает «AI-анализ» → получает оценку 0-100 + список замечаний по severity + готовые улучшенные варианты `title_kk/title_ru/excerpt_kk/excerpt_ru`. Можно одним кликом «применить улучшение». Если AI-ключа нет — фоллбек на `demoAnalysis()` с эвристиками по длинам.

## Системный промпт

```
Ты редактор казахоязычного образовательного портала. Проанализируй статью и верни JSON:
{
  "score": number 0-100 (общая оценка качества),
  "suggestions": [{"severity": "low"|"medium"|"high", "text": string, "field": "title"|"excerpt"|"content"}],
  "strengths": string[],
  "improved_title_kk"?: string,
  "improved_title_ru"?: string,
  "improved_excerpt_kk"?: string,
  "improved_excerpt_ru"?: string
}
Критерии: ясность заголовка, SEO-длина (title 50-60 симв, excerpt 120-160), грамматика, тон (нейтральный для новостей), структурированность контента.
Верни ТОЛЬКО валидный JSON, без markdown-обёрток, без комментариев.
```

## User-сообщение

```
Локаль основной публикации: {locale}

--- Title (kk) ---
{title_kk}
--- Title (ru) ---
{title_ru}
--- Excerpt (kk) ---
{excerpt_kk}
--- Excerpt (ru) ---
{excerpt_ru}
--- Content (kk) ---
{content_kk}
--- Content (ru) ---
{content_ru}
```

## Demo-fallback (без AI-ключа)

Простые эвристики по длинам, чтобы UI не был пустым:

```ts
if (titleLenKk < 30 || titleLenKk > 70) → suggestion 'medium' field=title
if (excerptLenKk < 100 || excerptLenKk > 200) → suggestion 'low' field=excerpt
score = 85 - 10*suggestions.length (но не < 40)
```

## Stripping code-fence (надёжность парсинга)

Gemini любит оборачивать в ```json ...```, хотя system prompt запрещает. Стрипаем:

```ts
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    const withoutFirst = trimmed.replace(/^```[a-zA-Z]*\s*/, '');
    return withoutFirst.replace(/```\s*$/, '').trim();
  }
  return trimmed;
}
```

## Как переиспользовать

1. **Замена сегмента**: заменить «казахоязычного образовательного» → свой («коммерческого e-com», «корпоративного блога», «научного журнала»). Критерии тоже свои:
   - Для e-com: «название продукта, USP, цена, CTA на покупку».
   - Для научного: «терминология, ссылки, аннотация, ключевые слова».
   - Для маркетинга: «hook, value proposition, social proof, urgency».
2. **SEO-длины** (50-60 / 120-160) — изменить под платформу: для VK Public — короче, для LinkedIn — длиннее.
3. **`improved_*` поля** — при моноязычном контенте оставить только `improved_title` / `improved_excerpt`.
4. **Severity** (`low/medium/high`) — стандарт, переиспользуется. UI красит замечания в светофор: серый/жёлтый/красный.

## Связанный код

- [`modules/editor/AISuggestionsPanel.tsx`](../modules/editor/AISuggestionsPanel.tsx) — UI-панель с кнопками «Применить улучшение» для каждого `improved_*` поля.
- [`modules/editor/analyze-content-route.ts`](../modules/editor/analyze-content-route.ts) — полный API endpoint с rate-limit + Zod-validation + demo-fallback.
