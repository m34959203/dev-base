import type { ArticleLike, Language } from "./types";

const CATEGORY_EMOJI: Record<string, string> = {
  news: "📰",
  tech: "💻",
  ai: "🤖",
  business: "💼",
  education: "🎓",
  marketing: "📈",
  design: "🎨",
  product: "🚀",
  tutorial: "📘",
  case: "📊",
};

function emojiForCategory(slug?: string | null): string {
  if (!slug) return "📰";
  return CATEGORY_EMOJI[slug.toLowerCase()] ?? "📰";
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function siteBase(): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? process.env.FRONTEND_URL ?? "https://technokod.kz";
}

function pickTitle(article: ArticleLike, lang: Language): string {
  const t = lang === "kk" ? article.titleKk : article.titleRu;
  return (t ?? article.titleRu ?? article.titleKk ?? "").trim();
}

function pickExcerpt(article: ArticleLike, lang: Language): string {
  const raw = lang === "kk" ? article.excerptKk : article.excerptRu;
  return raw ? stripHtml(raw) : "";
}

function pickSlug(article: ArticleLike, lang: Language): string {
  return (lang === "kk" ? article.slugKk : article.slugRu) ?? article.slugRu ?? article.slugKk ?? article.id;
}

export function articleUrl(article: ArticleLike, lang: Language): string {
  return `${siteBase()}/${lang}/blog/${pickSlug(article, lang)}`;
}

export function formatTelegramCaption(article: ArticleLike, lang: Language): string {
  const title = pickTitle(article, lang);
  const excerpt = pickExcerpt(article, lang);
  const emoji = emojiForCategory(article.category?.slug ?? null);
  const url = articleUrl(article, lang);

  const lines: string[] = [];
  lines.push(`${emoji} <b>${escapeHtml(title)}</b>`);
  lines.push("");

  if (excerpt) {
    const shortExcerpt = excerpt.length > 600 ? `${excerpt.slice(0, 600)}…` : excerpt;
    lines.push(escapeHtml(shortExcerpt));
    lines.push("");
  }

  if (article.category) {
    const name = (lang === "kk" ? article.category.nameKk : article.category.nameRu) ?? article.category.slug ?? "";
    if (name) lines.push(`🏷 <i>${escapeHtml(name)}</i>`);
  }

  if (article.tags && article.tags.length > 0) {
    const tagLine = article.tags
      .slice(0, 5)
      .map((t) => {
        const name = (lang === "kk" ? t.nameKk : t.nameRu) ?? t.slug ?? "";
        return name ? `#${name.replace(/\s+/g, "_")}` : "";
      })
      .filter(Boolean)
      .join(" ");
    if (tagLine) lines.push(tagLine);
  }

  if (article.isBreaking) {
    lines.push("");
    lines.push("🔥 <b>СРОЧНО</b>");
  }

  lines.push("");
  const cta = lang === "kk" ? "Толығырақ оқу →" : "Читать полностью →";
  lines.push(`📖 <a href="${url}">${cta}</a>`);

  // Telegram caption limit = 1024 for sendPhoto, 4096 for sendMessage.
  const out = lines.join("\n");
  return out.length > 4000 ? `${out.slice(0, 3996)}…` : out;
}

export function formatInstagramCaption(article: ArticleLike, lang: Language): string {
  const title = pickTitle(article, lang);
  const excerpt = pickExcerpt(article, lang);

  let caption = `${title}\n\n`;
  if (excerpt) {
    const short = excerpt.length > 500 ? `${excerpt.slice(0, 500)}…` : excerpt;
    caption += `${short}\n\n`;
  }

  caption += lang === "kk"
    ? "📰 technokod.kz сайтында толығырақ\n\n"
    : "📰 Подробнее на technokod.kz\n\n";

  const hashtags: string[] = [];
  if (article.category) {
    const name = (lang === "kk" ? article.category.nameKk : article.category.nameRu) ?? article.category.slug ?? "";
    if (name) hashtags.push(`#${name.replace(/\s+/g, "")}`);
  }
  if (article.tags) {
    for (const t of article.tags.slice(0, 10)) {
      const name = (lang === "kk" ? t.nameKk : t.nameRu) ?? t.slug ?? "";
      const clean = name.replace(/\s+/g, "").replace(/[^\wА-Яа-яЁёӘәІіҢңҒғҮүҰұҚқӨөҺһ]/g, "");
      if (clean) hashtags.push(`#${clean}`);
    }
  }
  hashtags.push("#technokod", "#Kazakhstan", "#Казахстан", "#IT", "#стартап", "#технологии");
  if (article.isBreaking) hashtags.push("#Breaking", "#Срочно");

  const uniq = Array.from(new Set(hashtags)).slice(0, 30);
  caption += uniq.join(" ");

  if (caption.length > 2200) {
    const base = `${title}\n\n`;
    const tags = uniq.join(" ");
    const budget = 2200 - base.length - tags.length - 4;
    const trimmedExcerpt = excerpt.slice(0, Math.max(0, budget));
    caption = `${base}${trimmedExcerpt}…\n\n${tags}`;
  }
  return caption;
}

export const __testing = { stripHtml, emojiForCategory, escapeHtml };
