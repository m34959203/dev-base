'use client';

import { useState } from 'react';
import {
  Sparkles,
  AlertCircle,
  AlertTriangle,
  Info,
  CheckCircle2,
  Loader2,
  X,
} from 'lucide-react';
import type { AIAnalysis, AIAnalysisSuggestion } from '@/lib/validators';

/**
 * AISuggestionsPanel — модалка AI-анализа статьи перед публикацией.
 *
 * Паттерн заимствован из AIMAK (apps/web/src/components/ai-suggestions-panel.tsx),
 * адаптирован под stack til-kural (Tailwind 4, lucide-react, без ui-библиотек
 * типа shadcn).
 *
 * Props описывают текущее состояние формы статьи. Onapply вызывается когда
 * пользователь жмёт «Применить» у улучшенного варианта — родительский
 * компонент (BilingualArticleForm) сам решает, как замёрджить патч в state.
 */

export interface AISuggestionsFormData {
  title_kk: string;
  title_ru: string;
  content_kk: string;
  content_ru: string;
  excerpt_kk?: string;
  excerpt_ru?: string;
}

export interface AISuggestionsPanelProps {
  formData: AISuggestionsFormData;
  locale: string;
  onApply: (patch: Partial<AISuggestionsFormData>) => void;
  /** Доп. классы контейнера кнопки (обычно не нужны). */
  className?: string;
}

function scoreColor(score: number): { ring: string; text: string; bg: string; label: string } {
  if (score >= 80) return { ring: 'ring-emerald-500', text: 'text-emerald-600', bg: 'bg-emerald-50', label: 'Өте жақсы' };
  if (score >= 60) return { ring: 'ring-amber-500', text: 'text-amber-600', bg: 'bg-amber-50', label: 'Жақсы' };
  if (score >= 40) return { ring: 'ring-orange-500', text: 'text-orange-600', bg: 'bg-orange-50', label: 'Орташа' };
  return { ring: 'ring-red-500', text: 'text-red-600', bg: 'bg-red-50', label: 'Жетілдіру керек' };
}

function severityIcon(sev: AIAnalysisSuggestion['severity']) {
  if (sev === 'high') return <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />;
  if (sev === 'medium') return <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />;
  return <Info className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />;
}

function severityBadge(sev: AIAnalysisSuggestion['severity']) {
  const map = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-blue-100 text-blue-700',
  };
  return (
    <span className={`text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded ${map[sev]}`}>
      {sev}
    </span>
  );
}

function fieldBadge(field?: AIAnalysisSuggestion['field']) {
  if (!field) return null;
  return (
    <span className="text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
      {field}
    </span>
  );
}

export default function AISuggestionsPanel({
  formData,
  locale,
  onApply,
  className = '',
}: AISuggestionsPanelProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AIAnalysis | null>(null);
  const [demoMode, setDemoMode] = useState(false);

  async function runAnalysis() {
    setOpen(true);
    setLoading(true);
    setError(null);
    setAnalysis(null);
    setDemoMode(false);

    try {
      const res = await fetch('/api/ai/analyze-content', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title_kk: formData.title_kk,
          title_ru: formData.title_ru,
          content_kk: formData.content_kk,
          content_ru: formData.content_ru,
          excerpt_kk: formData.excerpt_kk,
          excerpt_ru: formData.excerpt_ru,
          locale: locale === 'ru' ? 'ru' : 'kk',
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || `HTTP ${res.status}`);
      }

      const data = await res.json();
      if (!data?.analysis) throw new Error('Сервер қате жауап қайтарды');
      setAnalysis(data.analysis as AIAnalysis);
      setDemoMode(Boolean(data.demo));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setOpen(false);
  }

  function applyAndNotify(patch: Partial<AISuggestionsFormData>) {
    onApply(patch);
  }

  const color = analysis ? scoreColor(analysis.score) : null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={runAnalysis}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-indigo-600 to-purple-600 text-white text-sm font-medium hover:from-indigo-700 hover:to-purple-700 transition-colors shadow-sm"
      >
        <Sparkles className="w-4 h-4" />
        AI-анализ
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" onClick={close} aria-hidden />
          <div className="relative bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-600" />
                AI-талдау
                {demoMode && (
                  <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">демо</span>
                )}
              </h2>
              <button
                onClick={close}
                className="text-gray-400 hover:text-gray-600 p-1 rounded"
                aria-label="Жабу"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 overflow-y-auto flex-1">
              {loading && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="w-10 h-10 animate-spin text-indigo-600" />
                  <p className="text-sm text-gray-600">Gemini статьяны талдап жатыр…</p>
                </div>
              )}

              {error && !loading && (
                <div className="rounded-lg bg-red-50 border border-red-200 p-4 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-red-800">Талдау сәтсіз</p>
                    <p className="text-sm text-red-700 mt-1">{error}</p>
                    <button
                      onClick={runAnalysis}
                      className="mt-3 text-sm font-medium text-red-700 underline hover:no-underline"
                    >
                      Қайталап көру
                    </button>
                  </div>
                </div>
              )}

              {analysis && !loading && color && (
                <div className="space-y-6">
                  {/* Score ring */}
                  <div className="flex items-center gap-4">
                    <div
                      className={`w-24 h-24 rounded-full ring-4 ${color.ring} ${color.bg} flex items-center justify-center`}
                    >
                      <div className={`text-3xl font-bold ${color.text}`}>
                        {Math.round(analysis.score)}
                      </div>
                    </div>
                    <div>
                      <p className="text-sm text-gray-500">Жалпы баға</p>
                      <p className={`text-xl font-semibold ${color.text}`}>{color.label}</p>
                      <p className="text-xs text-gray-500 mt-1">0–100 шкаласы</p>
                    </div>
                  </div>

                  {/* Suggestions */}
                  {analysis.suggestions.length > 0 && (
                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">
                        Ұсыныстар ({analysis.suggestions.length})
                      </h3>
                      <ul className="space-y-2">
                        {analysis.suggestions.map((s, i) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 p-3 rounded-lg bg-gray-50 border border-gray-200"
                          >
                            {severityIcon(s.severity)}
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                {severityBadge(s.severity)}
                                {fieldBadge(s.field)}
                              </div>
                              <p className="text-sm text-gray-800">{s.text}</p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* Strengths */}
                  {analysis.strengths.length > 0 && (
                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">
                        Күшті жақтары
                      </h3>
                      <ul className="space-y-1.5">
                        {analysis.strengths.map((s, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-gray-800">
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                            <span>{s}</span>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

                  {/* Improved variants */}
                  {(analysis.improved_title_kk ||
                    analysis.improved_title_ru ||
                    analysis.improved_excerpt_kk ||
                    analysis.improved_excerpt_ru) && (
                    <section>
                      <h3 className="text-sm font-semibold text-gray-900 mb-2">
                        Жетілдірілген нұсқалар
                      </h3>
                      <div className="space-y-3">
                        {analysis.improved_title_kk && (
                          <ImprovedRow
                            label="Тақырып (kk)"
                            current={formData.title_kk}
                            suggested={analysis.improved_title_kk}
                            onApply={() =>
                              applyAndNotify({ title_kk: analysis.improved_title_kk })
                            }
                          />
                        )}
                        {analysis.improved_title_ru && (
                          <ImprovedRow
                            label="Заголовок (ru)"
                            current={formData.title_ru}
                            suggested={analysis.improved_title_ru}
                            onApply={() =>
                              applyAndNotify({ title_ru: analysis.improved_title_ru })
                            }
                          />
                        )}
                        {analysis.improved_excerpt_kk && (
                          <ImprovedRow
                            label="Қысқа мазмұны (kk)"
                            current={formData.excerpt_kk || ''}
                            suggested={analysis.improved_excerpt_kk}
                            onApply={() =>
                              applyAndNotify({ excerpt_kk: analysis.improved_excerpt_kk })
                            }
                          />
                        )}
                        {analysis.improved_excerpt_ru && (
                          <ImprovedRow
                            label="Краткое описание (ru)"
                            current={formData.excerpt_ru || ''}
                            suggested={analysis.improved_excerpt_ru}
                            onApply={() =>
                              applyAndNotify({ excerpt_ru: analysis.improved_excerpt_ru })
                            }
                          />
                        )}
                      </div>
                    </section>
                  )}

                  {analysis.suggestions.length === 0 &&
                    analysis.strengths.length === 0 &&
                    !analysis.improved_title_kk &&
                    !analysis.improved_title_ru && (
                      <p className="text-sm text-gray-500 text-center py-4">
                        AI ешқандай нақты ұсыныс таппады.
                      </p>
                    )}
                </div>
              )}
            </div>

            <div className="border-t px-6 py-3 flex items-center justify-end gap-2">
              <button
                onClick={close}
                className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100 rounded-lg"
              >
                Жабу
              </button>
              {analysis && (
                <button
                  onClick={runAnalysis}
                  className="px-4 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 hover:bg-indigo-100 rounded-lg"
                >
                  Қайта талдау
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ImprovedRow({
  label,
  current,
  suggested,
  onApply,
}: {
  label: string;
  current: string;
  suggested: string;
  onApply: () => void;
}) {
  const [applied, setApplied] = useState(false);

  function handle() {
    onApply();
    setApplied(true);
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
          {label}
        </span>
        <button
          type="button"
          onClick={handle}
          disabled={applied}
          className="text-xs font-medium px-3 py-1 rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:bg-emerald-600 disabled:cursor-default"
        >
          {applied ? 'Қолданылды' : 'Қолдану'}
        </button>
      </div>
      {current && (
        <p className="text-xs text-gray-500 mb-1">
          <span className="font-medium">Болды:</span> {current}
        </p>
      )}
      <p className="text-sm text-gray-900">
        <span className="font-medium text-indigo-700">Ұсыныс:</span> {suggested}
      </p>
    </div>
  );
}
