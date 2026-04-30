'use client';

/**
 * BilingualArticleForm — упрощённый порт паттерна `apps/web/src/components/article-form.tsx`
 * из `m34959203/AIMAK`. Одна страница редактора, табы KK/RU только для language-specific
 * полей. Общие поля (slug, cover, video, status, scheduled_at) вынесены наверх и едины для
 * обеих локалей.
 *
 * API:
 *   create  → POST /api/news
 *   edit    → PUT  /api/news/:id
 *
 * RichTextEditor импортируется как готовый компонент (его пишет другой агент).
 */

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input, { Textarea } from '@/components/ui/Input';
import RichTextEditor from '@/components/admin/RichTextEditor';
import { slugify } from '@/lib/utils';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NewsRow {
  id?: string;
  slug?: string;
  title_kk?: string | null;
  title_ru?: string | null;
  excerpt_kk?: string | null;
  excerpt_ru?: string | null;
  content_kk?: string | null;
  content_ru?: string | null;
  image_url?: string | null;
  video_url?: string | null;
  status?: 'draft' | 'published' | 'archived' | string | null;
  scheduled_at?: string | null;
  published_at?: string | null;
  updated_at?: string | null;
}

interface Props {
  mode: 'create' | 'edit';
  initialData?: NewsRow;
  locale: string;
}

type Lang = 'kk' | 'ru';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// datetime-local ожидает формат "YYYY-MM-DDTHH:mm" — приводим ISO к нему.
function toDatetimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function BilingualArticleForm({ mode, initialData, locale }: Props) {
  const router = useRouter();
  const isKk = locale === 'kk';

  // language-specific поля
  const [titleKk, setTitleKk] = useState(initialData?.title_kk ?? '');
  const [titleRu, setTitleRu] = useState(initialData?.title_ru ?? '');
  const [excerptKk, setExcerptKk] = useState(initialData?.excerpt_kk ?? '');
  const [excerptRu, setExcerptRu] = useState(initialData?.excerpt_ru ?? '');
  const [contentKk, setContentKk] = useState(initialData?.content_kk ?? '');
  const [contentRu, setContentRu] = useState(initialData?.content_ru ?? '');

  // общие поля
  const [slug, setSlug] = useState(initialData?.slug ?? '');
  const [imageUrl, setImageUrl] = useState(initialData?.image_url ?? '');
  const [videoUrl, setVideoUrl] = useState(initialData?.video_url ?? '');
  const [status, setStatus] = useState<string>(initialData?.status ?? 'draft');
  const [scheduledAt, setScheduledAt] = useState<string>(toDatetimeLocal(initialData?.scheduled_at));

  // UI state
  const [activeLang, setActiveLang] = useState<Lang>('kk');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [slugTouched, setSlugTouched] = useState(Boolean(initialData?.slug));

  const t = useMemo(
    () => ({
      titleNew: isKk ? 'Мақала редакторы' : 'Редактор статьи',
      commonSection: isKk ? 'Жалпы параметрлер' : 'Общие параметры',
      slug: 'Slug (URL)',
      slugHint: isKk
        ? 'title_ru негізінде автоматты түрде жасалады'
        : 'Генерируется автоматически из title_ru',
      imageUrl: isKk ? 'Мұқаба суреті (URL)' : 'Обложка (URL изображения)',
      imageRemove: isKk ? 'Өшіру' : 'Удалить',
      videoUrl: isKk ? 'Видео URL' : 'URL видео',
      status: isKk ? 'Күйі' : 'Статус',
      draft: isKk ? 'Жоба' : 'Черновик',
      published: isKk ? 'Жарияланды' : 'Опубликовано',
      archived: isKk ? 'Мұрағат' : 'Архив',
      scheduled: isKk ? 'Жоспарлы жариялау' : 'Запланированная публикация',
      scheduledHint: isKk
        ? 'Қолмен жариялау үшін бос қалдырыңыз'
        : 'Оставьте пустым для ручной публикации',
      langKk: 'Қазақша (KK)',
      langRu: 'Орысша (RU)',
      title: isKk ? 'Тақырыбы' : 'Заголовок',
      excerpt: isKk ? 'Қысқаша сипаттама' : 'Краткое описание',
      content: isKk ? 'Мазмұны' : 'Содержимое',
      saveDraft: isKk ? 'Жобаны сақтау' : 'Сохранить черновик',
      publishNow: isKk ? 'Қазір жариялау' : 'Опубликовать сейчас',
      cancel: isKk ? 'Болдырмау' : 'Отмена',
      required: isKk ? 'Кемінде 2 таңба' : 'Минимум 2 символа',
      saving: isKk ? 'Сақталуда…' : 'Сохраняем…',
      errGeneric: isKk ? 'Қате' : 'Ошибка',
    }),
    [isKk],
  );

  // Автогенерация slug из title_ru при потере фокуса title_ru, если пользователь ещё не
  // правил slug вручную.
  function handleTitleRuBlur() {
    if (!slugTouched && titleRu.trim()) {
      setSlug(slugify(titleRu));
    }
  }

  function validate(): boolean {
    const errs: Record<string, string> = {};
    if (titleKk.trim().length < 2) errs.title_kk = t.required;
    if (titleRu.trim().length < 2) errs.title_ru = t.required;
    setFieldErrors(errs);
    if (Object.keys(errs).length) {
      // Если ошибка в поле текущей не активной вкладки — переключаем.
      if ((errs.title_kk || errs.excerpt_kk) && activeLang !== 'kk') setActiveLang('kk');
      else if ((errs.title_ru || errs.excerpt_ru) && activeLang !== 'ru') setActiveLang('ru');
    }
    return Object.keys(errs).length === 0;
  }

  async function submit(overrideStatus?: string) {
    setError(null);
    if (!validate()) return;

    const body = {
      title_kk: titleKk.trim(),
      title_ru: titleRu.trim(),
      slug: slug.trim() || undefined,
      excerpt_kk: excerptKk.trim() || undefined,
      excerpt_ru: excerptRu.trim() || undefined,
      content_kk: contentKk || undefined,
      content_ru: contentRu || undefined,
      image_url: imageUrl.trim() || undefined,
      video_url: videoUrl.trim() || undefined,
      status: overrideStatus || status,
      scheduled_at: scheduledAt || undefined,
    };

    setSaving(true);
    try {
      const url = mode === 'edit' && initialData?.id ? `/api/news/${initialData.id}` : '/api/news';
      const method = mode === 'edit' ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        if (Array.isArray(j.errors) && j.errors.length) {
          const map: Record<string, string> = {};
          for (const e of j.errors as Array<{ field?: string; message?: string }>) {
            if (e?.field && e?.message && !map[e.field]) map[e.field] = e.message;
          }
          setFieldErrors(map);
          setError(j.error || t.errGeneric);
          return;
        }
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      // успех → назад в список
      router.push(`/${locale}/admin/editor`);
      router.refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  // ---------------- render ----------------

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="space-y-6"
    >
      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* -------- Общие поля -------- */}
      <Card>
        <h2 className="text-base font-semibold text-gray-900 mb-4">{t.commonSection}</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input
            label={t.slug}
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setSlugTouched(true);
            }}
            placeholder="auto"
            helperText={t.slugHint}
            error={fieldErrors.slug}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.status}</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            >
              <option value="draft">{t.draft}</option>
              <option value="published">{t.published}</option>
              <option value="archived">{t.archived}</option>
            </select>
          </div>

          <div className="md:col-span-2">
            <Input
              label={t.imageUrl}
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="https://…"
              error={fieldErrors.image_url}
            />
            {imageUrl && (
              <div className="mt-2 flex items-start gap-3">
                {/* Превью через <img>, без next/image — URL произвольный, домен может быть не в next.config */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="cover preview"
                  className="w-32 h-20 object-cover rounded-lg border border-gray-200"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.display = 'none';
                  }}
                />
                <Button type="button" variant="ghost" size="sm" onClick={() => setImageUrl('')}>
                  {t.imageRemove}
                </Button>
              </div>
            )}
          </div>

          <Input
            label={t.videoUrl}
            value={videoUrl}
            onChange={(e) => setVideoUrl(e.target.value)}
            placeholder="https://youtube.com/…"
            error={fieldErrors.video_url}
            className="md:col-span-1"
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.scheduled}</label>
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full px-4 py-2.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-teal-500"
            />
            <p className="mt-1 text-xs text-gray-500">{t.scheduledHint}</p>
          </div>
        </div>
      </Card>

      {/* -------- KK/RU табы -------- */}
      <Card>
        <div className="flex border-b border-gray-200 mb-4 -mt-1">
          {(['kk', 'ru'] as Lang[]).map((lang) => (
            <button
              key={lang}
              type="button"
              onClick={() => setActiveLang(lang)}
              className={
                'px-4 py-2.5 text-sm font-medium -mb-px transition-colors ' +
                (activeLang === lang
                  ? 'text-teal-700 border-b-2 border-teal-700'
                  : 'text-gray-500 hover:text-gray-700')
              }
            >
              {lang === 'kk' ? t.langKk : t.langRu}
            </button>
          ))}
        </div>

        {/* KK panel */}
        <div className={activeLang === 'kk' ? 'space-y-4' : 'hidden'}>
          <Input
            label={`${t.title} (KK)`}
            value={titleKk}
            onChange={(e) => setTitleKk(e.target.value)}
            error={fieldErrors.title_kk}
            required
          />
          <Textarea
            label={`${t.excerpt} (KK)`}
            value={excerptKk}
            onChange={(e) => setExcerptKk(e.target.value)}
            error={fieldErrors.excerpt_kk}
            rows={3}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.content} (KK)</label>
            <RichTextEditor value={contentKk} onChange={setContentKk} />
          </div>
        </div>

        {/* RU panel */}
        <div className={activeLang === 'ru' ? 'space-y-4' : 'hidden'}>
          <Input
            label={`${t.title} (RU)`}
            value={titleRu}
            onChange={(e) => setTitleRu(e.target.value)}
            onBlur={handleTitleRuBlur}
            error={fieldErrors.title_ru}
            required
          />
          <Textarea
            label={`${t.excerpt} (RU)`}
            value={excerptRu}
            onChange={(e) => setExcerptRu(e.target.value)}
            error={fieldErrors.excerpt_ru}
            rows={3}
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t.content} (RU)</label>
            <RichTextEditor value={contentRu} onChange={setContentRu} />
          </div>
        </div>
      </Card>

      {/* -------- Actions -------- */}
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" variant="primary" loading={saving} disabled={saving}>
          {saving ? t.saving : t.saveDraft}
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={saving}
          disabled={saving}
          onClick={() => {
            setStatus('published');
            // submit принудительно с published, чтобы не ждать set-state
            void submit('published');
          }}
        >
          {t.publishNow}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={saving}
          onClick={() => router.push(`/${locale}/admin/editor`)}
        >
          {t.cancel}
        </Button>
      </div>
    </form>
  );
}
