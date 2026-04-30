# modules/admin/

Admin shell + sidebar + EntityCrudTable + dashboard. Battle-tested в 6 проектах (technokod, til-kural, dvorets, smart-library-cbs, smart-kids-library, new.zhezu.kz).

## Файлы

### Layout / Shell

- [`admin-layout-rbac.tsx`](admin-layout-rbac.tsx) — server-component layout с `requireRole(["admin", "editor"])` + redirect на login. **Single-locale** (technokod-style). Для bilingual — нужно обернуть в `[locale]` route group (dvorets-style).
- [`AdminShell.tsx`](AdminShell.tsx) — главный shell: sidebar + header с user-pill + content. Группированная навигация (Обзор / Контент / Публикации / Аналитика / Настройки), активный путь подсвечен, logout button.

### Sidebars (два варианта)

- [`AdminSidebar.bilingual.tsx`](AdminSidebar.bilingual.tsx) — til-kural вариант: `label_kk` + `label_ru`, lucide-react иконки, sectioned nav.
- [`AdminSidebar.dvorets.tsx`](AdminSidebar.dvorets.tsx) — dvorets вариант: i18n via `useTranslations()`, inline-SVG иконки. Меньше зависимостей.

### Dashboard widgets

- [`DashboardStats.tsx`](DashboardStats.tsx) — карточки KPI: total / thisWeek / won / conversion. Цветовые блоки.
- [`RecentLeads.tsx`](RecentLeads.tsx) — лента последних 10 лидов со статусом. Адаптируется под любую сущность (replace `Lead` на `Article` / `User` / etc).

### CRUD

- [`EntityCrudTable.tsx`](EntityCrudTable.tsx) — generic CRUD-table. Для одной сущности: search/sort/pagination, server/client autoswitch (≤500 rows = client; >500 = server). Принимает Zod-схему по `apiPath`. ~640 строк, ноль project-specific.

## Архитектура

```
app/(admin)/admin/                   ← route group
├── layout.tsx                       ← admin-layout-rbac.tsx (RBAC + redirect)
│   └── <AdminShell>
│       └── <AdminSidebar locale={locale} />
│
├── page.tsx                         ← dashboard (DashboardStats + RecentLeads)
├── articles/
│   ├── page.tsx                     ← list (EntityCrudTable apiPath="/api/admin/articles")
│   └── [id]/page.tsx                ← edit (BilingualArticleForm — см. modules/editor/)
├── users/page.tsx                   ← list (EntityCrudTable)
├── settings/page.tsx                ← key/value form (см. modules/admin-settings/ TBD)
└── ...
```

## Использование

### 1. Layout

```tsx
// app/(admin)/admin/layout.tsx
import { requireRole } from '@/lib/auth';
import { redirect } from 'next/navigation';
import { AdminShell } from '@/components/admin/AdminShell';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  try {
    const user = await requireRole(['admin', 'editor']);
    return <AdminShell user={user}>{children}</AdminShell>;
  } catch {
    redirect('/admin/login');
  }
}
```

### 2. Dashboard page

```tsx
// app/(admin)/admin/page.tsx
import { DashboardStats } from '@/components/admin/DashboardStats';
import { RecentLeads } from '@/components/admin/RecentLeads';

export default async function AdminDashboard() {
  const [stats, recentLeads] = await Promise.all([
    fetchStats(),
    prisma.lead.findMany({ take: 10, orderBy: { createdAt: 'desc' }}),
  ]);

  return (
    <div className="space-y-6">
      <DashboardStats stats={stats} />
      <RecentLeads leads={recentLeads} />
    </div>
  );
}
```

### 3. CRUD-страница

```tsx
// app/(admin)/admin/articles/page.tsx
import { EntityCrudTable } from '@/components/admin/EntityCrudTable';

export default function ArticlesAdmin() {
  return (
    <EntityCrudTable
      apiPath="/api/admin/articles"
      entityName="Articles"
      columns={[
        { key: 'title', label: 'Title', sortable: true },
        { key: 'status', label: 'Status', filter: ['draft', 'published'] },
        { key: 'createdAt', label: 'Created', format: 'date', sortable: true },
      ]}
      schema={ArticleZodSchema}
      newPath="/admin/articles/new"
      editPath={(row) => `/admin/articles/${row.id}`}
    />
  );
}
```

## Адаптация при копировании

1. **Auth-хелпер** — заменить `requireRole`/`requireUser` на свои; убедиться что AuthError handle'ится в layout.
2. **Sidebar items** — наполнить под свои разделы; убрать project-specific (Living Doc, Sprint3, etc).
3. **Brand colors** — поменять `bg-tk-*` / `text-tk-*` Tailwind классы на свои токены или закомментить.
4. **i18n** — для bilingual использовать AdminSidebar.bilingual.tsx; для одной локали — упростить AdminSidebar.dvorets.tsx, убрав `useTranslations()`.
5. **EntityCrudTable schema** — Zod-схемы хранить рядом с API-route (`src/lib/validators.ts`). EntityCrudTable принимает Zod через prop.
6. **DashboardStats poles** — заменить `total/thisWeek/won/conversion` на свои метрики (`articles/published/views/avgRating` etc).

## Альтернативы

- **`new.zhezu.kz/zhezu-app/src/app/admin/layout.tsx`** — третий вариант, **без БД**: JWT-cookie auth + verifyToken. Полезно как «легковесная админка» для статичных проектов. Не вытащено в dev-base — слишком project-specific.
- **vestnik-frontend admin** — простой меню-каталог, без CRUD. Для научного журнала с минимальной админкой (модерация статей через OJS, не Next.js admin).

## Связанные

- [`playbooks/scaffold-admin.md`](../../playbooks/scaffold-admin.md) — пошаговый сценарий поднятия админки в новом проекте (TBD).
- [`modules/auth/`](../auth/) — JWT + refresh + RBAC (`requireRole`, `AuthError`).
- [`modules/editor/`](../editor/) — BilingualArticleForm + RichTextEditor для CMS-страниц (TBD).
