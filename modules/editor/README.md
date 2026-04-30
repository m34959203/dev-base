# modules/editor/

TipTap-based редактор для bilingual (kk/ru) контента + AI-валидация перед публикацией. Source: til-kural.

## Файлы

- [`RichTextEditor.tsx`](RichTextEditor.tsx) — TipTap v3, ~360 LOC. Toolbar: B/I/U, headings (H1-H4), lists, link, image, YouTube-video, align (left/center/right/justify), undo/redo. lucide-react иконки. **Включает кастомные NodeView'ы:** ResizableImage + ResizableVideo с drag-handles.
- [`extensions/resizable-image.ts`](extensions/resizable-image.ts) — TipTap NodeView: drag-resize за 4 угловых хэндла, сохраняет width/height в attrs.
- [`extensions/resizable-video.ts`](extensions/resizable-video.ts) — то же для embed YouTube (iframe).
- [`BilingualArticleForm.tsx`](BilingualArticleForm.tsx) — kk/ru табы для language-specific полей (title, excerpt, content), общие поля (slug, cover, scheduled_at) сверху. AI-actions (analyze / translate / improve).
- [`AISuggestionsPanel.tsx`](AISuggestionsPanel.tsx) — UI score 0-100 + список suggestions со severity + кнопки «Применить улучшение» для `improved_title_kk/_ru/excerpt_kk/_ru`.
- [`analyze-content-route.ts`](analyze-content-route.ts) — POST `/api/ai/analyze-content`. Rate-limit, Zod, demo-mode fallback без ключа. Использует prompt из [`prompts/ai-content-analysis.md`](../../prompts/ai-content-analysis.md).

## Зависимости

```json
{
  "@tiptap/react": "^3.0.0",
  "@tiptap/starter-kit": "^3.0.0",
  "@tiptap/extension-link": "^3.0.0",
  "@tiptap/extension-image": "^3.0.0",
  "@tiptap/extension-text-align": "^3.0.0",
  "@tiptap/extension-underline": "^3.0.0",
  "@tiptap/extension-character-count": "^3.0.0",
  "lucide-react": "^0.400.0"
}
```

## Использование

### RichTextEditor в форме

```tsx
import { RichTextEditor } from '@/components/admin/RichTextEditor';

const [content, setContent] = useState(initialHTML);

<RichTextEditor
  value={content}
  onChange={setContent}
  placeholder="Начните писать..."
  uploadEndpoint="/api/admin/upload"  // для drag-drop изображений
/>
```

### BilingualArticleForm

```tsx
import { BilingualArticleForm } from '@/components/admin/BilingualArticleForm';

<BilingualArticleForm
  initialData={article}
  onSubmit={async (data) => { await fetch(`/api/admin/articles/${id}`, { method: 'PATCH', body: JSON.stringify(data) }); }}
  aiAnalyzeEndpoint="/api/ai/analyze-content"
  aiTranslateEndpoint="/api/ai/translate"
/>
```

## Архитектура: общие vs локализованные поля

```
┌─────────────────────────────────────┐
│ Общие поля                          │
│ slug, cover_image, status,          │
│ scheduled_at, tags                  │
├─────────────────────────────────────┤
│ Tab: Қазақша (kk)                   │
│ ┌─────────────────────────────────┐ │
│ │ title_kk                        │ │
│ │ excerpt_kk                      │ │
│ │ content_kk (RichTextEditor)     │ │
│ └─────────────────────────────────┘ │
├─────────────────────────────────────┤
│ Tab: Русский (ru)                   │
│ ... те же поля _ru                  │
├─────────────────────────────────────┤
│ AI Actions Panel                    │
│ ┌─[ Analyze ]──[ Translate kk→ru ]┐│
│ └────────────────────────────────┘ │
│ AISuggestionsPanel                  │
└─────────────────────────────────────┘
```

## Адаптация при копировании

1. **Брэнд-цвета** — `bg-tk-*` Tailwind классы → свои.
2. **Upload endpoint** — `/api/admin/upload` должен принимать multipart и возвращать `{ url }`. Реализация в til-kural через S3-совместимое хранилище / локальный диск.
3. **i18n labels** — для не-bilingual упростить до одного таба или вытащить в общий блок.
4. **AI endpoints** — `/api/ai/analyze-content` + `/api/ai/translate` — драйверы лежат в `modules/ai/`. Из коробки требуют `assertQuota()` (см. ai-quota-guard playbook).
5. **TipTap extensions** — можно добавлять свои (Tables, Mathematics, EmbedTwitter — в til-kural не вытащил, есть в technokod через `@tiptap/extension-table` и др.).

## Подводные камни

- **TipTap v3 vs v2** — несовместимы. Если у тебя v2 (technokod), берёшь только концепт BilingualArticleForm + переписываешь под свой stack. ResizableImage NodeView в v3 — переписать через v2 API.
- **`output: 'standalone'`** — TipTap нормально работает; никаких extra-config.
- **SSR** — TipTap **client-only**, в form'е `'use client'`. Если рендеришь HTML в server-component — используй `TiptapRenderer` (в technokod есть, можно вытащить отдельно).
- **alt-текст** — обязателен для изображений (SEO + a11y). В `RichTextEditor` форма image-вставки запрашивает alt.

## Связанные

- [`prompts/ai-content-analysis.md`](../../prompts/ai-content-analysis.md) — промпт для `/api/ai/analyze-content`.
- [`modules/admin/`](../admin/) — admin shell где живёт форма.
- [`modules/ai/`](../ai/) — AI-quota guard для AI-actions.
