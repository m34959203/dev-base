'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ZodType } from 'zod';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import MarkdownPreview from '@/components/admin/MarkdownPreview';
import { SCHEMAS, validateBody } from '@/lib/validators';

export type FieldType = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'select' | 'checkbox';

export interface CrudField {
  name: string;
  label_kk: string;
  label_ru: string;
  type: FieldType;
  required?: boolean;
  options?: { value: string; label_kk: string; label_ru: string }[];
  placeholder?: string;
  defaultValue?: unknown;
}

export type ColumnFormat = 'text' | 'status' | 'boolean' | 'date' | 'datetime' | 'truncate';

export interface CrudColumn {
  field: string;
  label_kk: string;
  label_ru: string;
  format?: ColumnFormat;
  truncate?: number;
}

export interface EntityCrudConfig {
  apiPath: string;           // e.g. "/api/news"
  listKey: string;           // root key of GET list response, e.g. "news"
  itemKey: string;           // root key of single item in POST/PUT/GET(id), e.g. "news" (for news) or "lesson"
  titleKk: string;
  titleRu: string;
  fields: CrudField[];
  columns: CrudColumn[];
  // Zod-схема подхватывается автоматически через SCHEMAS[apiPath] из
  // src/lib/validators.ts. Поле schema удалено из публичного config, потому
  // что Zod-инстанс (класс) нельзя передавать из server-component в
  // client-component (Next.js ругается «Only plain objects»).
}

type Row = Record<string, unknown> & { id: string };

interface Props {
  locale: string;
  config: EntityCrudConfig;
}

type SortState = { field: string; dir: 'asc' | 'desc' } | null;

const PAGE_SIZES = [10, 25, 50, 100] as const;

export default function EntityCrudTable({ locale, config }: Props) {
  const isKk = locale === 'kk';
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Эффективная схема: автолукап по apiPath из общего SCHEMAS-мапа.
  const schema: ZodType | undefined = SCHEMAS[config.apiPath];

  // UX: search / sort / paginate.
  // Режим server-mode включается автоматически: если первый ответ API вернул
  // `total`/`totalPages` — мы переключаемся на серверный поиск/пагинацию и
  // шлём page/limit/search как query-параметры. Иначе всё считается на клиенте.
  const [query, setQuery] = useState('');           // то, что пользователь печатает (сразу)
  const [debouncedQuery, setDebouncedQuery] = useState(''); // фактический поиск (300ms debounce)
  const [sort, setSort] = useState<SortState>(null);
  const [pageSize, setPageSize] = useState<number>(25);
  const [page, setPage] = useState(1); // 1-based
  const [serverMode, setServerMode] = useState(false);
  const [serverTotal, setServerTotal] = useState(0);
  const [serverTotalPages, setServerTotalPages] = useState(1);

  // Debounce поиска: 300мс. Пока пользователь печатает, сетевой запрос не уходит.
  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(id);
  }, [query]);

  // Снимок page/pageSize/debouncedQuery для стабильной зависимости в reload().
  const reqParams = useMemo(() => ({
    page,
    limit: pageSize,
    search: debouncedQuery.trim(),
  }), [page, pageSize, debouncedQuery]);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      // Строим URL: в server-режиме кладём page/limit/search в query-string.
      // В первый заход server-режим ещё не известен — шлём параметры всегда,
      // роуты бэкенда умеют их игнорировать (через `paginated` флаг).
      const url = new URL(config.apiPath, typeof window === 'undefined' ? 'http://local' : window.location.origin);
      url.searchParams.set('page', String(reqParams.page));
      url.searchParams.set('limit', String(reqParams.limit));
      if (reqParams.search) url.searchParams.set('search', reqParams.search);

      const res = await fetch(url.pathname + url.search);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setRows((data[config.listKey] || []) as Row[]);

      // Автоопределение server-mode по наличию total/totalPages в ответе.
      if (typeof data.total === 'number' && typeof data.totalPages === 'number') {
        setServerMode(true);
        setServerTotal(data.total);
        setServerTotalPages(Math.max(1, data.totalPages));
      } else {
        setServerMode(false);
      }
    } catch (e) {
      console.error(e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [config.apiPath, config.listKey, reqParams]);

  useEffect(() => { reload(); }, [reload]);

  // Reset to first page whenever client-side filter/sort/page-size changes.
  // В server-mode page-size тоже должен сбрасывать page (через reqParams пойдёт fetch).
  const prevServerMode = useRef(serverMode);
  useEffect(() => {
    // В server-mode debouncedQuery/pageSize уже триггерят fetch через reqParams;
    // нам нужно только сбросить page в 1 при смене фильтра.
    if (serverMode) {
      // page сбрасываем только когда изменился именно фильтр, не сам page.
      // (если сам page меняется — оставляем).
      setPage(1);
      return;
    }
    // Клиентский режим: классический сброс.
    setPage(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedQuery, pageSize]);

  // При переключении серверного режима (редкий кейс) — тоже сбрасываем страницу.
  useEffect(() => {
    if (prevServerMode.current !== serverMode) {
      prevServerMode.current = serverMode;
      setPage(1);
    }
  }, [serverMode]);

  // --- Клиентский фильтр + сортировка + пагинация (только для !serverMode) ---
  const filteredRows = useMemo(() => {
    if (serverMode) return rows; // в серверном режиме search уже применён на бэке
    const q = debouncedQuery.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((row) => {
      for (const col of config.columns) {
        const v = row[col.field];
        if (typeof v === 'string' && v.toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [rows, debouncedQuery, config.columns, serverMode]);

  const sortedRows = useMemo(() => {
    // В server-mode сортировку делаем тоже клиентскую, но только НАД загруженной
    // страницей — это даёт быстрый визуальный отклик, хотя по-настоящему сортирует
    // бэкенд (orderBy). TODO: вынести sort как query-param, если понадобится.
    if (!sort) return filteredRows;
    const { field, dir } = sort;
    const sign = dir === 'asc' ? 1 : -1;
    const copy = [...filteredRows];
    copy.sort((a, b) => {
      const av = a[field];
      const bv = b[field];
      if (av === bv) return 0;
      if (av === null || av === undefined || av === '') return 1;
      if (bv === null || bv === undefined || bv === '') return -1;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
      // date-ish
      const ad = Date.parse(String(av));
      const bd = Date.parse(String(bv));
      if (!Number.isNaN(ad) && !Number.isNaN(bd)) return (ad - bd) * sign;
      return String(av).localeCompare(String(bv)) * sign;
    });
    return copy;
  }, [filteredRows, sort]);

  // Итоговые числа для отображения и пагинации.
  const total = serverMode ? serverTotal : sortedRows.length;
  const totalPages = serverMode
    ? serverTotalPages
    : Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, totalPages);
  // В server-mode текущая страница — это вся полученная выборка (бэкенд уже
  // порезал). В клиентском режиме — локальный slice.
  const startIdx = serverMode
    ? (total === 0 ? 0 : (safePage - 1) * pageSize)
    : (safePage - 1) * pageSize;
  const endIdx = serverMode
    ? Math.min(startIdx + sortedRows.length, total)
    : Math.min(startIdx + pageSize, total);
  const pageRows = serverMode ? sortedRows : sortedRows.slice(startIdx, endIdx);

  const toggleSort = (field: string) => {
    setSort((prev) => {
      if (!prev || prev.field !== field) return { field, dir: 'asc' };
      if (prev.dir === 'asc') return { field, dir: 'desc' };
      return null; // third click clears sort
    });
  };

  const openCreate = () => {
    const init: Record<string, unknown> = {};
    for (const f of config.fields) {
      init[f.name] = f.defaultValue ?? (f.type === 'checkbox' ? false : f.type === 'number' ? 0 : '');
    }
    setFormData(init);
    setCreating(true);
    setEditing(null);
  };

  const openEdit = (row: Row) => {
    const init: Record<string, unknown> = {};
    for (const f of config.fields) {
      init[f.name] = row[f.name] ?? (f.type === 'checkbox' ? false : f.type === 'number' ? 0 : '');
    }
    setFormData(init);
    setEditing(row);
    setCreating(false);
  };

  const closeForm = () => {
    setEditing(null);
    setCreating(false);
    setFormData({});
    setError(null);
    setFieldErrors({});
  };

  const submit = async () => {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      // 1) Client-side Zod validation (если схема доступна).
      if (schema) {
        const clientResult = validateBody(schema, formData);
        if (!clientResult.ok) {
          const map: Record<string, string> = {};
          for (const e of clientResult.errors) {
            if (!map[e.field]) map[e.field] = e.message;
          }
          setFieldErrors(map);
          setError(isKk ? 'Өрістерді тексеріңіз' : 'Проверьте поля');
          return;
        }
      }

      const url = editing ? `${config.apiPath}/${editing.id}` : config.apiPath;
      const method = editing ? 'PUT' : 'POST';
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        // 2) Server-side errors in {errors: [{field, message}]} shape?
        if (Array.isArray(j.errors) && j.errors.length) {
          const map: Record<string, string> = {};
          for (const e of j.errors as Array<{ field?: string; message?: string }>) {
            if (e?.field && e?.message && !map[e.field]) map[e.field] = e.message;
          }
          setFieldErrors(map);
          setError(j.error || (isKk ? 'Өрістерді тексеріңіз' : 'Проверьте поля'));
          return;
        }
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      closeForm();
      await reload();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row: Row) => {
    if (!confirm(isKk ? 'Жою керек пе?' : 'Точно удалить?')) return;
    try {
      const res = await fetch(`${config.apiPath}/${row.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await reload();
    } catch (e) {
      alert(String(e));
    }
  };

  const showingLabel = total === 0
    ? (isKk ? '0 жазба' : '0 записей')
    : (isKk
        ? `${startIdx + 1}–${endIdx} / ${total}`
        : `${startIdx + 1}–${endIdx} из ${total}`);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-gray-900">{isKk ? config.titleKk : config.titleRu}</h1>
        <Button onClick={openCreate}>{isKk ? 'Жаңа қосу' : 'Добавить'}</Button>
      </div>

      <Card>
        {/* Toolbar: search + page size */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-4">
          <div className="flex-1 max-w-md">
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={isKk ? 'Іздеу…' : 'Поиск…'}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            />
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-600">
            <span>{isKk ? 'Бетте:' : 'На стр.:'}</span>
            <select
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-gray-400">{isKk ? 'Жүктелуде…' : 'Загрузка…'}</div>
        ) : total === 0 ? (
          // Пусто: в server-mode total=0 значит ровно "ничего нет/не найдено".
          // В клиентском режиме различаем "совсем пусто" и "не найдено по поиску".
          !serverMode && rows.length === 0 ? (
            <div className="text-center py-8 text-gray-400">{isKk ? 'Жазбалар жоқ' : 'Записей нет'}</div>
          ) : !debouncedQuery.trim() ? (
            <div className="text-center py-8 text-gray-400">{isKk ? 'Жазбалар жоқ' : 'Записей нет'}</div>
          ) : (
            <div className="text-center py-8 text-gray-400">
              {isKk ? 'Сәйкестік табылмады' : 'Ничего не найдено'}
            </div>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left">
                  {config.columns.map((c) => {
                    const active = sort?.field === c.field;
                    const arrow = active ? (sort!.dir === 'asc' ? ' ↑' : ' ↓') : '';
                    return (
                      <th
                        key={c.field}
                        className="pb-3 font-medium text-gray-500 cursor-pointer select-none hover:text-gray-700"
                        onClick={() => toggleSort(c.field)}
                        title={isKk ? 'Сұрыптау' : 'Сортировать'}
                      >
                        {isKk ? c.label_kk : c.label_ru}
                        <span className={active ? 'text-teal-700' : 'text-gray-300'}>{arrow || ' ↕'}</span>
                      </th>
                    );
                  })}
                  <th className="pb-3 font-medium text-gray-500 text-right">{isKk ? 'Әрекеттер' : 'Действия'}</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row) => (
                  <tr key={row.id} className="border-b last:border-0 hover:bg-gray-50 align-top">
                    {config.columns.map((c) => (
                      <td key={c.field} className="py-3 text-gray-800">
                        {renderCell(row[c.field], c)}
                      </td>
                    ))}
                    <td className="py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <Button size="sm" variant="ghost" onClick={() => openEdit(row)}>
                          {isKk ? 'Өңдеу' : 'Редактировать'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => remove(row)}>
                          {isKk ? 'Жою' : 'Удалить'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination footer */}
        {!loading && total > 0 && (
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mt-4 text-sm text-gray-600">
            <div>{showingLabel}</div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={safePage <= 1}
              >
                {isKk ? '← Артқа' : '← Назад'}
              </Button>
              <span className="px-2">
                {isKk ? `${safePage} / ${totalPages} бет` : `Стр. ${safePage} / ${totalPages}`}
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={safePage >= totalPages}
              >
                {isKk ? 'Алға →' : 'Вперёд →'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {(creating || editing) && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeForm}>
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="p-6 border-b flex items-center justify-between">
              <h2 className="text-xl font-bold">
                {editing ? (isKk ? 'Өңдеу' : 'Редактирование') : (isKk ? 'Жаңа жазба' : 'Новая запись')}
              </h2>
              <button onClick={closeForm} className="text-gray-400 hover:text-gray-600 text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              {config.fields.map((f) => (
                <FormField
                  key={f.name}
                  field={f}
                  locale={locale}
                  value={formData[f.name]}
                  error={fieldErrors[f.name]}
                  onChange={(v) => {
                    setFormData((prev) => ({ ...prev, [f.name]: v }));
                    // Сразу убираем ошибку этого поля, чтобы пользователь видел реакцию на правку.
                    if (fieldErrors[f.name]) {
                      setFieldErrors((prev) => {
                        const next = { ...prev };
                        delete next[f.name];
                        return next;
                      });
                    }
                  }}
                />
              ))}
              {error && <div className="text-red-600 text-sm">{error}</div>}
            </div>
            <div className="p-6 border-t flex justify-end gap-3">
              <Button variant="ghost" onClick={closeForm}>{isKk ? 'Болдырмау' : 'Отмена'}</Button>
              <Button onClick={submit} loading={saving}>
                {isKk ? 'Сақтау' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderCell(value: unknown, col: CrudColumn): React.ReactNode {
  if (value === null || value === undefined || value === '') return '—';
  switch (col.format) {
    case 'status': {
      const v = String(value);
      const cls = v === 'published' || v === 'active' || v === 'upcoming'
        ? 'bg-green-100 text-green-700'
        : v === 'draft'
        ? 'bg-gray-100 text-gray-600'
        : v === 'admin'
        ? 'bg-red-100 text-red-700'
        : v === 'editor' || v === 'moderator'
        ? 'bg-amber-100 text-amber-700'
        : 'bg-gray-100 text-gray-600';
      return <span className={`px-2 py-0.5 rounded-full text-xs ${cls}`}>{v}</span>;
    }
    case 'boolean': {
      const ok = !!value;
      return (
        <span className={`px-2 py-0.5 rounded-full text-xs ${ok ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
          {ok ? '✓' : '—'}
        </span>
      );
    }
    case 'date':
      try { return new Date(String(value)).toLocaleDateString(); } catch { return String(value); }
    case 'datetime':
      try { return new Date(String(value)).toLocaleString(); } catch { return String(value); }
    case 'truncate': {
      const s = String(value);
      const n = col.truncate ?? 80;
      return s.length > n ? s.slice(0, n) + '…' : s;
    }
    default:
      return String(value);
  }
}

function FormField({
  field,
  locale,
  value,
  error,
  onChange,
}: {
  field: CrudField;
  locale: string;
  value: unknown;
  error?: string;
  onChange: (v: unknown) => void;
}) {
  const isKk = locale === 'kk';
  const label = isKk ? field.label_kk : field.label_ru;
  const borderCls = error
    ? 'border-red-500 focus:ring-red-500'
    : 'border-gray-300 focus:ring-teal-500';
  const commonInput = `w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 ${borderCls}`;
  const [mdMode, setMdMode] = useState<'edit' | 'preview'>('edit');

  if (field.type === 'checkbox') {
    return (
      <div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => onChange(e.target.checked)}
            className="w-4 h-4 accent-teal-600"
          />
          <span className="text-sm text-gray-700">{label}</span>
        </label>
        {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <label className="block text-sm font-medium text-gray-700">
          {label} {field.required && <span className="text-red-500">*</span>}
        </label>
        {field.type === 'textarea' && (
          <div className="inline-flex rounded-md border border-gray-200 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setMdMode('edit')}
              className={`px-2 py-1 ${mdMode === 'edit' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {isKk ? 'Өңдеу' : 'Редактор'}
            </button>
            <button
              type="button"
              onClick={() => setMdMode('preview')}
              className={`px-2 py-1 border-l border-gray-200 ${mdMode === 'preview' ? 'bg-teal-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >
              {isKk ? 'Алдын ала' : 'Превью'}
            </button>
          </div>
        )}
      </div>
      {field.type === 'textarea' ? (
        mdMode === 'edit' ? (
          <textarea
            className={commonInput + ' min-h-[100px]'}
            value={String(value ?? '')}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            aria-invalid={!!error}
          />
        ) : (
          <MarkdownPreview value={String(value ?? '')} />
        )
      ) : field.type === 'select' ? (
        <select
          className={commonInput}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
        >
          <option value="">—</option>
          {field.options?.map((o) => (
            <option key={o.value} value={o.value}>{isKk ? o.label_kk : o.label_ru}</option>
          ))}
        </select>
      ) : field.type === 'number' ? (
        <input
          type="number"
          className={commonInput}
          value={Number(value ?? 0)}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-invalid={!!error}
        />
      ) : field.type === 'date' ? (
        <input
          type="date"
          className={commonInput}
          value={String(value ?? '').slice(0, 10)}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
        />
      ) : field.type === 'datetime' ? (
        <input
          type="datetime-local"
          className={commonInput}
          value={String(value ?? '').slice(0, 16)}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={!!error}
        />
      ) : (
        <input
          type="text"
          className={commonInput}
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          placeholder={field.placeholder}
          aria-invalid={!!error}
        />
      )}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}
