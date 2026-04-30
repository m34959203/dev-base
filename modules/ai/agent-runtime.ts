import { prisma } from "@/lib/db";
import { aiComplete, type AIResult } from "@/lib/ai";
import { logger } from "@/lib/logger";
import { fetchSearchSummary as ynFetch, isConnected as yandexConnected } from "@/lib/yandex-webmaster";
import { fetchSearchSummary as gscFetch, isConfigured as gscConfigured } from "@/lib/gsc";

export interface AgentRunContext {
  leadId?: string | null;
  extra?: Record<string, unknown>;
}

export interface AgentRunInput {
  slug: string;
  userMessage: string;
  purpose?: string;
  context?: AgentRunContext;
  userId?: string | null;
}

export interface AgentRunResult {
  ok: boolean;
  runId?: string;
  agentTitle?: string;
  response?: string;
  error?: string;
  costUsd?: number;
}

export async function runAgent(input: AgentRunInput): Promise<AgentRunResult> {
  const agent = await prisma.agent.findUnique({ where: { slug: input.slug } });
  if (!agent) return { ok: false, error: `agent '${input.slug}' not found` };
  if (!agent.enabled) return { ok: false, error: `agent '${input.slug}' disabled` };

  const purpose = (input.purpose || "custom") as
    | "translate" | "title" | "excerpt" | "seo" | "improve" | "custom";

  const systemBlocks: string[] = [agent.systemPrompt];
  if (agent.focus) systemBlocks.push(`\n\nТвоя зона ответственности:\n${agent.focus}`);
  systemBlocks.push(
    "\n\nПиши кратко и по делу на русском. Отвечай в формате Markdown, максимум 600 слов. " +
      "Если нужна информация — скажи чего не хватает. Не галлюцинируй цифры.",
  );

  const contextBlock = await buildContext(input.context);
  const fullPrompt = contextBlock
    ? `${contextBlock}\n\n---\n\n${input.userMessage}`
    : input.userMessage;

  let result: AIResult | null = null;
  let errMsg: string | null = null;
  const started = Date.now();
  try {
    result = await aiComplete({
      prompt: fullPrompt,
      system: systemBlocks.join(""),
      model: agent.model,
      purpose,
      userId: input.userId ?? null,
    });
  } catch (err) {
    errMsg = err instanceof Error ? err.message : "AI call failed";
    logger.warn("agents.run_failed", { slug: input.slug, err: errMsg });
  }

  const run = await prisma.agentRun.create({
    data: {
      agentId: agent.id,
      purpose,
      prompt: input.userMessage.slice(0, 10000),
      response: result?.text ?? "",
      contextJson: (input.context?.extra as object) ?? null,
      leadId: input.context?.leadId ?? null,
      tokensIn: result?.usage.promptTokens ?? 0,
      tokensOut: result?.usage.completionTokens ?? 0,
      costUsd: result?.usage.costUsd ?? 0,
      durationMs: result?.usage.durationMs ?? Date.now() - started,
      error: errMsg,
    },
    select: { id: true, costUsd: true },
  });

  if (!result) return { ok: false, runId: run.id, error: errMsg ?? "no response" };
  return {
    ok: true,
    runId: run.id,
    agentTitle: agent.title,
    response: result.text,
    costUsd: run.costUsd,
  };
}

async function buildContext(ctx?: AgentRunContext): Promise<string> {
  const parts: string[] = [];

  // Always inject company snapshot (real data)
  const snapshot = await buildCompanySnapshot().catch(() => null);
  if (snapshot) parts.push(snapshot);

  if (!ctx) return parts.join("\n\n---\n\n");

  // Lead context
  if (ctx.leadId) {
    const lead = await prisma.lead.findUnique({
      where: { id: ctx.leadId },
      select: {
        name: true, email: true, phone: true, company: true,
        message: true, source: true, status: true, note: true, createdAt: true,
      },
    });
    if (lead) {
      parts.push(
        `КОНТЕКСТ ЛИДА:\n` +
          `Имя: ${lead.name}\nТелефон: ${lead.phone}\nEmail: ${lead.email || "—"}\n` +
          `Компания: ${lead.company || "—"}\nСтатус: ${lead.status}\n` +
          `Источник: ${lead.source || "—"}\n` +
          `Создан: ${lead.createdAt.toISOString().slice(0, 10)}\n` +
          `Сообщение: ${lead.message || "—"}\n` +
          `Заметка: ${lead.note || "—"}`,
      );
      // Recent WA messages with this lead's phone
      const chatId = `${lead.phone.replace(/\D/g, "")}@s.whatsapp.net`;
      const wa = await prisma.whatsAppMessage.findMany({
        where: { chatId },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: { direction: true, content: true, createdAt: true },
      });
      if (wa.length) {
        const log = wa.reverse().map(
          (m: { direction: string; content: string | null }) =>
            `${m.direction === "incoming" ? "Клиент" : "Мы"}: ${(m.content ?? "").slice(0, 200)}`,
        ).join("\n");
        parts.push(`ПЕРЕПИСКА WHATSAPP (последние ${wa.length}):\n${log}`);
      }
    }
  }

  // Living document summary (pinned sections only)
  const pinned = await prisma.livingDocSection.findMany({
    where: { pinned: true },
    orderBy: { position: "asc" },
    take: 5,
    select: { title: true, body: true },
  }).catch(() => []);
  if (pinned.length) {
    parts.push(
      `ЖИВОЙ ДОКУМЕНТ (закреплённые секции):\n` +
        pinned.map((s) => `## ${s.title}\n${s.body.slice(0, 800)}`).join("\n\n"),
    );
  }

  if (ctx.extra) {
    parts.push(`ДОПОЛНИТЕЛЬНО:\n${JSON.stringify(ctx.extra, null, 2).slice(0, 2000)}`);
  }

  return parts.join("\n\n---\n\n");
}

async function buildCompanySnapshot(): Promise<string> {
  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60_000);
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
  const d1 = new Date(now.getTime() - 24 * 60 * 60_000);

  // Run independent queries in parallel, each with its own .catch so one failure doesn't blank the snapshot
  const [
    leadsTotal, leads7d, leadsByStatus, leadSources,
    articlesByStatus,
    pubs30d,
    aiToday, ai7d,
    waCfg, waTotalMsg, waIn7d, waOut7d,
    docSections,
    evt7d, sess7d, sess30d, utmBreakdown, topPaths, formSubmits7d, recentPubs,
    siteContent, recentArticles,
  ] = await Promise.all([
    prisma.lead.count().catch(() => 0),
    prisma.lead.count({ where: { createdAt: { gte: d7 } } }).catch(() => 0),
    prisma.lead.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []),
    prisma.lead.groupBy({
      by: ["source"],
      where: { createdAt: { gte: d30 } },
      _count: { _all: true },
    }).catch(() => []),
    prisma.article.groupBy({ by: ["status"], _count: { _all: true } }).catch(() => []),
    prisma.socialMediaPublication.groupBy({
      by: ["platform", "status"],
      where: { createdAt: { gte: d30 } },
      _count: { _all: true },
    }).catch(() => []),
    prisma.aIGeneration.aggregate({
      where: { createdAt: { gte: d1 } },
      _count: { _all: true },
      _sum: { promptTokens: true, completionTokens: true, costUsd: true },
    }).catch(() => null),
    prisma.aIGeneration.aggregate({
      where: { createdAt: { gte: d7 } },
      _count: { _all: true },
      _sum: { costUsd: true },
    }).catch(() => null),
    prisma.whatsAppSession.findUnique({ where: { id: "creds" } }).catch(() => null),
    prisma.whatsAppMessage.count().catch(() => 0),
    prisma.whatsAppMessage.count({
      where: { direction: "incoming", createdAt: { gte: d7 } },
    }).catch(() => 0),
    prisma.whatsAppMessage.count({
      where: { direction: "outgoing", createdAt: { gte: d7 } },
    }).catch(() => 0),
    prisma.livingDocSection.findMany({
      orderBy: [{ pinned: "desc" }, { position: "asc" }],
      take: 10,
      select: { title: true, body: true, pinned: true },
    }).catch(() => []),
    // Marketing metrics
    prisma.analyticsEvent.count({ where: { createdAt: { gte: d7 } } }).catch(() => 0),
    prisma.analyticsSession.count({ where: { createdAt: { gte: d7 } } }).catch(() => 0),
    prisma.analyticsSession.count({ where: { createdAt: { gte: d30 } } }).catch(() => 0),
    prisma.analyticsSession.groupBy({
      by: ["utmSource"],
      where: { createdAt: { gte: d30 } },
      _count: { _all: true },
      orderBy: { _count: { sessionKey: "desc" } },
      take: 6,
    }).catch(() => []),
    prisma.analyticsEvent.groupBy({
      by: ["path"],
      where: { createdAt: { gte: d7 }, type: "PAGE_VIEW" },
      _count: { _all: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }).catch(() => []),
    prisma.analyticsEvent.count({
      where: { createdAt: { gte: d7 }, type: "LEAD_SUBMITTED" },
    }).catch(() => 0),
    prisma.socialMediaPublication.findMany({
      where: { createdAt: { gte: d30 }, status: "SUCCESS" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        platform: true, language: true, url: true, createdAt: true, payload: true,
      },
    }).catch(() => []),
    // Content agents need to actually see
    prisma.siteContent.findMany({
      select: { section: true, data_ru: true },
    }).catch(() => []),
    prisma.article.findMany({
      where: { status: "published" },
      orderBy: { publishedAt: "desc" },
      take: 5,
      select: {
        slug: true, title_ru: true, excerpt_ru: true, publishedAt: true,
      },
    }).catch(() => []),
  ]);


  const leadsStatusLine =
    (leadsByStatus as Array<{ status: string; _count: { _all: number } }>)
      .map((r) => `${r.status}:${r._count._all}`).join(" · ") || "—";
  const leadsSourceLine =
    (leadSources as Array<{ source: string | null; _count: { _all: number } }>)
      .map((r) => `${r.source || "—"}:${r._count._all}`).join(" · ") || "—";
  const articlesLine =
    (articlesByStatus as Array<{ status: string; _count: { _all: number } }>)
      .map((r) => `${r.status}:${r._count._all}`).join(" · ") || "—";
  const pubsLine =
    (pubs30d as Array<{ platform: string; status: string; _count: { _all: number } }>)
      .map((r) => `${r.platform}/${r.status}:${r._count._all}`).join(" · ") || "—";

  const aiTodayCount = aiToday?._count._all ?? 0;
  const aiTodayCost = aiToday?._sum.costUsd ?? 0;
  const ai7dCount = ai7d?._count._all ?? 0;
  const ai7dCost = ai7d?._sum.costUsd ?? 0;

  const lines: string[] = [
    "СНИМОК СОСТОЯНИЯ КОМПАНИИ (на момент запроса):",
    "",
    "## Лиды",
    `Всего: ${leadsTotal} · За 7 дней: ${leads7d}`,
    `По статусам: ${leadsStatusLine}`,
    `Источники (30 дней): ${leadsSourceLine}`,
    "",
    "## Контент",
    `Статьи по статусам: ${articlesLine}`,
    `Публикации в соцсети (30 дней): ${pubsLine}`,
    "",
    "## AI-расход",
    `Сегодня (24ч): ${aiTodayCount} вызовов, стоимость ~$${aiTodayCost.toFixed(4)}`,
    `За 7 дней: ${ai7dCount} вызовов, стоимость ~$${ai7dCost.toFixed(4)}`,
    "",
    "## WhatsApp",
    `Шлюз: ${waCfg ? "подключён (есть creds)" : "не подключён"}`,
    `Сообщений всего: ${waTotalMsg} · За 7 дней: входящих ${waIn7d}, исходящих ${waOut7d}`,
    "",
    "## Маркетинг (сайт)",
    `Сессий: ${sess7d} за 7 дней · ${sess30d} за 30 дней`,
    `События: ${evt7d} за 7 дней`,
    `Формы отправлены: ${formSubmits7d} за 7 дней` +
      (sess7d > 0
        ? ` · Конверсия session→form: ${((formSubmits7d / sess7d) * 100).toFixed(1)}%`
        : ""),
    `Топ страниц (7 дней): ${
      (topPaths as Array<{ path: string; _count: { _all: number } }>)
        .map((r) => `${r.path}:${r._count._all}`)
        .join(" · ") || "—"
    }`,
    `Источники (UTM, 30 дней): ${
      (utmBreakdown as Array<{ utmSource: string | null; _count: { _all: number } }>)
        .map((r) => `${r.utmSource || "direct"}:${r._count._all}`)
        .join(" · ") || "—"
    }`,
    `Последние публикации (30 дней): ${
      (recentPubs as Array<{ platform: string; language: string; url: string | null; createdAt: Date }>)
        .map((r) => `${r.platform}/${r.language}${r.url ? " " + r.url : ""} (${r.createdAt.toISOString().slice(0, 10)})`)
        .join(" · ") || "—"
    }`,
  ];

  // Google Search Console (if service account configured)
  if (await gscConfigured().catch(() => false)) {
    const gs = await gscFetch(7).catch(() => null);
    if (gs) {
      lines.push(
        "",
        "## Поиск — Google (7 дней)",
        `Показы: ${gs.totalImpressions} · Клики: ${gs.totalClicks} · CTR: ${(gs.averageCtr * 100).toFixed(2)}% · Средняя позиция: ${gs.averagePosition.toFixed(1)}`,
        `Топ-запросы: ${
          gs.topQueries
            .slice(0, 5)
            .map((q) => `"${q.query}" (${q.clicks}кл/${q.impressions}п, поз.${q.position.toFixed(1)})`)
            .join(" · ") || "—"
        }`,
      );
    }
  }

  // Yandex Webmaster (if connected)
  if (await yandexConnected().catch(() => false)) {
    const yn = await ynFetch(7).catch(() => null);
    if (yn) {
      lines.push(
        "",
        "## Поиск — Яндекс (7 дней)",
        `Показы: ${yn.totalShows} · Клики: ${yn.totalClicks} · CTR: ${(yn.averageCtr * 100).toFixed(2)}%`,
        `Топ-запросы: ${
          yn.topQueries
            .slice(0, 5)
            .map((q) => `"${q.query}" (${q.clicks}кл/${q.shows}п)`)
            .join(" · ") || "—"
        }`,
      );
    }
  }

  // Actual site content (landing copy)
  if ((siteContent as Array<{section: string}>).length) {
    lines.push("", "## Контент лендинга (site_content, RU)");
    for (const s of siteContent as Array<{ section: string; data_ru: unknown }>) {
      const body = JSON.stringify(s.data_ru);
      lines.push(`**${s.section}**: ${body.slice(0, 700)}`);
    }
  }

  // Recent articles
  if ((recentArticles as unknown[]).length) {
    lines.push("", "## Опубликованные статьи (последние 5)");
    for (const a of recentArticles as Array<{
      slug: string; title_ru: string; excerpt_ru: string | null; publishedAt: Date | null;
    }>) {
      const date = a.publishedAt?.toISOString().slice(0, 10) ?? "—";
      lines.push(`- **${a.title_ru}** (${date}, /blog/${a.slug})${a.excerpt_ru ? `\n  ${a.excerpt_ru.slice(0, 300)}` : ""}`);
    }
  }

  // Actual social publication texts
  if ((recentPubs as Array<{payload?: unknown}>).length) {
    lines.push("", "## Последние посты в соцсети (текст)");
    for (const p of recentPubs as Array<{
      platform: string; language: string; url: string | null; createdAt: Date; payload: unknown;
    }>) {
      const pl = p.payload as { text?: string; caption?: string; message?: string } | null;
      const text = pl?.text ?? pl?.caption ?? pl?.message ?? "";
      lines.push(`- **${p.platform}/${p.language}** (${p.createdAt.toISOString().slice(0, 10)}): ${text.slice(0, 300) || "—"}`);
    }
  }

  if (docSections.length) {
    lines.push("", "## Живой документ (все секции)");
    for (const s of docSections as Array<{ title: string; body: string; pinned: boolean }>) {
      lines.push(
        `### ${s.pinned ? "[закреплено] " : ""}${s.title}`,
        s.body.slice(0, 600).trim() || "(пусто)",
      );
    }
  }

  return lines.join("\n");
}

// Convenience: append agent output as a new section in the living doc
export async function appendToLivingDoc(
  agentId: string,
  title: string,
  body: string,
  options?: { pinned?: boolean; position?: number },
): Promise<string> {
  const doc = await prisma.livingDoc.upsert({
    where: { key: "main" },
    update: {},
    create: { key: "main", title: "Живой документ компании" },
  });
  const max = await prisma.livingDocSection.aggregate({
    where: { docId: doc.id },
    _max: { position: true },
  });
  const section = await prisma.livingDocSection.create({
    data: {
      docId: doc.id,
      title,
      body,
      position: options?.position ?? (max._max.position ?? 0) + 1,
      pinned: options?.pinned ?? false,
      authorAgentId: agentId,
    },
    select: { id: true },
  });
  return section.id;
}
