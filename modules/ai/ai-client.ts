import { prisma } from "@/lib/db";
import type { Locale } from "@/lib/i18n";
import { getSecret } from "@/lib/settings";
import { assertQuota } from "@/lib/ai-quota";

// Unified AI client. Primary: Gemini (@google/genai). Fallback: OpenRouter.
// Every call is logged to AIGeneration.

export type AIPurpose =
  | "translate"
  | "title"
  | "excerpt"
  | "seo"
  | "improve"
  | "custom";

export interface AIUsage {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  durationMs: number;
}

export interface AIResult {
  text: string;
  usage: AIUsage;
}

export interface AICompleteArgs {
  prompt: string;
  system?: string;
  model?: string;
  purpose: AIPurpose;
  userId?: string | null;
}

// Rough pricing per 1M tokens (USD). Update as providers change.
const PRICING: Record<string, { in: number; out: number }> = {
  "gemini-2.5-flash": { in: 0.075, out: 0.3 },
  "gemini-2.5-pro": { in: 1.25, out: 10 },
  "openai/gpt-4o-mini": { in: 0.15, out: 0.6 },
  "anthropic/claude-3.5-haiku": { in: 0.8, out: 4 },
};

const DEFAULT_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const DEFAULT_OPENROUTER_MODEL =
  process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini";

function computeCost(model: string, promptTokens: number, completionTokens: number): number {
  const price = PRICING[model];
  if (!price) return 0;
  return (promptTokens / 1_000_000) * price.in + (completionTokens / 1_000_000) * price.out;
}

async function callGemini(args: AICompleteArgs): Promise<AIResult> {
  const apiKey = await getSecret("GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI_API_KEY missing");
  const model = args.model || DEFAULT_GEMINI_MODEL;

  // Hard free-tier guard: throws QuotaExceededError if we're at 90% of any limit.
  // Ensures we never dip into paid tier even with billing enabled.
  await assertQuota(model);

  const started = Date.now();

  // Dynamically import so local build doesn't require the dep at type-check when absent.
  const mod = (await import("@google/genai")) as unknown as {
    GoogleGenAI: new (opts: { apiKey: string }) => {
      models: {
        generateContent(params: {
          model: string;
          contents: string;
          config?: { systemInstruction?: string };
        }): Promise<{
          text?: string;
          usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
        }>;
      };
    };
  };

  const client = new mod.GoogleGenAI({ apiKey });
  const resp = await client.models.generateContent({
    model,
    contents: args.prompt,
    config: args.system ? { systemInstruction: args.system } : undefined,
  });

  const text = resp.text ?? "";
  const promptTokens = resp.usageMetadata?.promptTokenCount ?? 0;
  const completionTokens = resp.usageMetadata?.candidatesTokenCount ?? 0;
  const durationMs = Date.now() - started;

  return {
    text,
    usage: {
      provider: "gemini",
      model,
      promptTokens,
      completionTokens,
      costUsd: computeCost(model, promptTokens, completionTokens),
      durationMs,
    },
  };
}

async function callOpenRouter(args: AICompleteArgs): Promise<AIResult> {
  const apiKey = await getSecret("OPENROUTER_API_KEY");
  if (!apiKey) throw new Error("OPENROUTER_API_KEY missing");
  const model = args.model || DEFAULT_OPENROUTER_MODEL;
  const started = Date.now();

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "HTTP-Referer": process.env.APP_URL || "https://technokod.kz",
      "X-Title": "Technokod",
    },
    body: JSON.stringify({
      model,
      messages: [
        ...(args.system ? [{ role: "system", content: args.system }] : []),
        { role: "user", content: args.prompt },
      ],
    }),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`OpenRouter ${resp.status}: ${errText}`);
  }

  const data = (await resp.json()) as {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number };
  };

  const text = data.choices?.[0]?.message?.content ?? "";
  const promptTokens = data.usage?.prompt_tokens ?? 0;
  const completionTokens = data.usage?.completion_tokens ?? 0;
  const durationMs = Date.now() - started;

  return {
    text,
    usage: {
      provider: "openrouter",
      model,
      promptTokens,
      completionTokens,
      costUsd: computeCost(model, promptTokens, completionTokens),
      durationMs,
    },
  };
}

async function logGeneration(usage: AIUsage, purpose: AIPurpose, userId?: string | null): Promise<void> {
  try {
    await prisma.aIGeneration.create({
      data: {
        provider: usage.provider,
        model: usage.model,
        purpose,
        promptTokens: usage.promptTokens,
        completionTokens: usage.completionTokens,
        costUsd: usage.costUsd,
        durationMs: usage.durationMs,
        userId: userId ?? null,
      },
    });
  } catch {
    // logging should never block the main request
  }
}

async function callClaudeCli(args: AICompleteArgs): Promise<AIResult> {
  const url = process.env.CLAUDE_BRIDGE_URL || "http://claude-bridge:3300";
  const secret = process.env.CLAUDE_BRIDGE_SECRET || "";
  if (!secret) throw new Error("CLAUDE_BRIDGE_SECRET not set");

  // Map friendly aliases: claude-cli → default (Opus), claude-cli-sonnet, -haiku, -opus
  const m = (args.model || "").toLowerCase();
  const cliModel = m.includes("sonnet") ? "sonnet" : m.includes("haiku") ? "haiku" : "opus";

  const started = Date.now();
  const resp = await fetch(`${url}/run`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Secret": secret,
    },
    body: JSON.stringify({
      prompt: args.prompt,
      system: args.system,
      model: cliModel,
    }),
    signal: AbortSignal.timeout(120_000),
  });

  if (!resp.ok) {
    const errText = await resp.text().catch(() => "");
    throw new Error(`claude-bridge ${resp.status}: ${errText.slice(0, 200)}`);
  }
  const data = (await resp.json()) as {
    ok?: boolean;
    text?: string;
    error?: string;
    usage?: {
      inputTokens?: number;
      outputTokens?: number;
      costUsd?: number;
      model?: string;
      durationMs?: number;
    };
  };
  if (!data.ok) throw new Error(`claude-bridge: ${data.error || "unknown"}`);

  return {
    text: data.text ?? "",
    usage: {
      provider: "claude-cli",
      model: data.usage?.model || `claude-cli-${cliModel}`,
      promptTokens: data.usage?.inputTokens ?? 0,
      completionTokens: data.usage?.outputTokens ?? 0,
      // claude-cli goes through Claude Max subscription — marginal cost $0
      costUsd: 0,
      durationMs: data.usage?.durationMs ?? Date.now() - started,
    },
  };
}

export async function aiComplete(args: AICompleteArgs): Promise<AIResult> {
  const modelLc = (args.model || "").toLowerCase();
  const isGemini = modelLc.startsWith("gemini");
  const isOpenRouter = modelLc.includes("/");

  if (isGemini) {
    const result = await callGemini(args);
    await logGeneration(result.usage, args.purpose, args.userId);
    return result;
  }
  if (isOpenRouter) {
    const result = await callOpenRouter(args);
    await logGeneration(result.usage, args.purpose, args.userId);
    return result;
  }
  const result = await callClaudeCli(args);
  await logGeneration(result.usage, args.purpose, args.userId);
  return result;
}

// --- Helpers ---

const LANG_NAMES: Record<string, string> = {
  kk: "Казахский (Kazakh)",
  ru: "Русский (Russian)",
  en: "English",
};

export async function translate(
  text: string,
  from: string,
  to: string,
  userId?: string | null,
): Promise<AIResult> {
  const system =
    "Ты профессиональный переводчик. Переводи точно, сохраняя форматирование, тон, термины и HTML/Markdown разметку если она есть. Не добавляй комментариев.";
  const prompt = `Переведи следующий текст с ${LANG_NAMES[from] || from} на ${LANG_NAMES[to] || to}. Верни только перевод без пояснений.\n\nТекст:\n${text}`;
  return aiComplete({ prompt, system, purpose: "translate", userId });
}

export type SuggestPurpose = "title" | "excerpt" | "seo" | "improve";

export async function suggest(
  purpose: SuggestPurpose,
  content: string,
  locale: Locale,
  userId?: string | null,
): Promise<AIResult> {
  const langName = locale === "kk" ? "казахском" : "русском";
  let system = "Ты — редактор блога технологической компании Technokod. Пиши ясно, профессионально и по делу.";
  let prompt = "";

  switch (purpose) {
    case "title":
      prompt = `Предложи 5 вариантов цепляющего заголовка на ${langName} языке для статьи. Формат: нумерованный список. Длина каждого — до 70 символов.\n\nСтатья:\n${content}`;
      break;
    case "excerpt":
      prompt = `Напиши краткое описание (excerpt) на ${langName} языке, 1-2 предложения (до 200 символов), для превью статьи. Без заголовка, без вступительных фраз. Только сам текст.\n\nСтатья:\n${content}`;
      break;
    case "seo":
      system += " Ты также эксперт по SEO.";
      prompt = `Сгенерируй SEO-мета для этой статьи на ${langName} языке. Верни строгий JSON без обёртки в \`\`\`: {"title": "...", "description": "..."}. title до 60 символов, description до 155 символов.\n\nСтатья:\n${content}`;
      break;
    case "improve":
      prompt = `Улучши текст на ${langName} языке: сделай его более чётким, убери воду, сохрани смысл и структуру. Верни только улучшенный текст без комментариев.\n\nТекст:\n${content}`;
      break;
  }

  return aiComplete({ prompt, system, purpose, userId });
}
