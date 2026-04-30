import { GoogleGenerativeAI } from '@google/generative-ai';
import { requireAdminApi, apiError, aiQuotaErrorResponse } from '@/lib/api';
import { AIAnalysisSchema, type AIAnalysis } from '@/lib/validators';
import { assertQuota } from '@/lib/ai-quota';
import { approxTokens, logGeneration } from '@/lib/ai-log';

const ANALYZE_MODEL = 'gemini-2.5-flash';

/**
 * POST /api/ai/analyze-content
 *
 * Админский AI-анализ статьи перед публикацией:
 *   - оценка качества 0..100
 *   - список suggestions (severity + текст + опциональное поле)
 *   - strengths[] — за что похвалить автора
 *   - improved_title_kk/_ru, improved_excerpt_kk/_ru — готовые варианты,
 *     которые UI может применить одним кликом («Применить»).
 *
 * ВАЖНО: маршрут защищён `requireAdminApi`, чтобы анонимы не тратили
 * квоту Gemini (см. `feedback_technokod_roles` в памяти — тот же приём).
 *
 * В демо-режиме (GEMINI_API_KEY не задан) возвращаем детерминированную
 * заглушку — удобно для локальной разработки без ключа.
 */

const apiKey = process.env.GEMINI_API_KEY || '';

interface AnalyzePayload {
  title_kk?: string;
  title_ru?: string;
  content_kk?: string;
  content_ru?: string;
  excerpt_kk?: string;
  excerpt_ru?: string;
  locale?: 'kk' | 'ru';
}

const SYSTEM_PROMPT = `Ты редактор казахоязычного образовательного портала. Проанализируй статью и верни JSON:
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
Верни ТОЛЬКО валидный JSON, без markdown-обёрток, без комментариев.`;

/**
 * Чистим возможные markdown-обёртки (\`\`\`json ... \`\`\`) — Gemini любит
 * оборачивать ответ, хотя system prompt запрещает.
 */
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('```')) {
    // убираем первую строку с ```json / ``` и последнюю ```
    const withoutFirst = trimmed.replace(/^```[a-zA-Z]*\s*/, '');
    return withoutFirst.replace(/```\s*$/, '').trim();
  }
  return trimmed;
}

function buildUserMessage(data: AnalyzePayload): string {
  const locale = data.locale === 'ru' ? 'ru' : 'kk';
  return [
    `Локаль основной публикации: ${locale}`,
    '',
    `--- Title (kk) ---`,
    data.title_kk || '(пусто)',
    `--- Title (ru) ---`,
    data.title_ru || '(пусто)',
    `--- Excerpt (kk) ---`,
    data.excerpt_kk || '(пусто)',
    `--- Excerpt (ru) ---`,
    data.excerpt_ru || '(пусто)',
    `--- Content (kk) ---`,
    data.content_kk || '(пусто)',
    `--- Content (ru) ---`,
    data.content_ru || '(пусто)',
  ].join('\n');
}

function demoAnalysis(data: AnalyzePayload): AIAnalysis {
  const titleLenKk = (data.title_kk || '').length;
  const titleLenRu = (data.title_ru || '').length;
  const excerptLenKk = (data.excerpt_kk || '').length;

  const suggestions: AIAnalysis['suggestions'] = [];
  if (titleLenKk > 0 && (titleLenKk < 30 || titleLenKk > 70)) {
    suggestions.push({
      severity: 'medium',
      text: `Казахский заголовок ${titleLenKk} симв. — оптимум 50–60 для SEO.`,
      field: 'title',
    });
  }
  if (titleLenRu > 0 && (titleLenRu < 30 || titleLenRu > 70)) {
    suggestions.push({
      severity: 'medium',
      text: `Русский заголовок ${titleLenRu} симв. — оптимум 50–60 для SEO.`,
      field: 'title',
    });
  }
  if (excerptLenKk > 0 && (excerptLenKk < 80 || excerptLenKk > 200)) {
    suggestions.push({
      severity: 'low',
      text: `Excerpt ${excerptLenKk} симв. — оптимум 120–160 для meta description.`,
      field: 'excerpt',
    });
  }

  return {
    score: suggestions.length === 0 ? 85 : Math.max(40, 85 - suggestions.length * 10),
    suggestions,
    strengths: ['Заголовки на двух языках заполнены (демо-режим без GEMINI_API_KEY).'],
  };
}

export async function POST(request: Request) {
  const auth = await requireAdminApi(request);
  if (auth instanceof Response) return auth;

  let body: AnalyzePayload;
  try {
    body = (await request.json()) as AnalyzePayload;
  } catch {
    return apiError(400, 'Invalid JSON body');
  }

  if (!body || typeof body !== 'object') {
    return apiError(400, 'Body must be an object');
  }

  // Минимальная sanity-проверка: хоть один kk-заголовок или kk-контент нужен.
  if (!body.title_kk && !body.title_ru && !body.content_kk && !body.content_ru) {
    return apiError(400, 'Nothing to analyze: title/content required');
  }

  // Без API-ключа — возвращаем детерминированный демо-ответ, чтобы UI работал.
  if (!apiKey) {
    return Response.json({ analysis: demoAnalysis(body), demo: true });
  }

  try {
    await assertQuota(ANALYZE_MODEL);

    const client = new GoogleGenerativeAI(apiKey);
    const model = client.getGenerativeModel({ model: ANALYZE_MODEL });

    const userMessage = buildUserMessage(body);
    const startedAt = Date.now();
    const result = await model.generateContent({
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      systemInstruction: SYSTEM_PROMPT,
      // Просим модель отдавать JSON — строгий mode не всегда доступен для
      // gemini-2.5-flash, поэтому дублируем требование в системке.
      generationConfig: { responseMimeType: 'application/json' },
    });

    const raw = result.response.text();
    const usage = (result.response as unknown as { usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number } }).usageMetadata;
    await logGeneration({
      provider: 'gemini',
      model: ANALYZE_MODEL,
      purpose: 'analyze-content',
      promptTokens: usage?.promptTokenCount ?? approxTokens(SYSTEM_PROMPT + userMessage),
      completionTokens: usage?.candidatesTokenCount ?? approxTokens(raw),
      durationMs: Date.now() - startedAt,
      userId: auth.id,
    });

    const cleaned = stripCodeFences(raw);

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.error('[analyze-content] JSON.parse failed', err, raw);
      return apiError(502, 'AI returned non-JSON response', raw.slice(0, 500));
    }

    const safe = AIAnalysisSchema.safeParse(parsed);
    if (!safe.success) {
      console.error('[analyze-content] schema failed', safe.error.issues);
      return apiError(502, 'AI response failed schema validation', safe.error.issues);
    }

    return Response.json({ analysis: safe.data });
  } catch (err) {
    const quota = aiQuotaErrorResponse(err);
    if (quota) return quota;
    console.error('[analyze-content] gemini call failed', err);
    return apiError(500, 'AI analysis failed', String(err));
  }
}
