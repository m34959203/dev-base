'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  LineChart,
  BookOpen,
  CheckSquare,
  Scale,
  PenSquare,
  CalendarDays,
  Image as ImageIcon,
  FileVideo,
  Building2,
  Briefcase,
  ScrollText,
  BookMarked,
  Users,
  ShieldCheck,
  Settings,
  Home,
  Activity,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface AdminSidebarProps {
  locale: string;
}

interface NavItem {
  href: string;
  label_kk: string;
  label_ru: string;
  Icon: LucideIcon;
}

interface NavSection {
  title_kk: string;
  title_ru: string;
  items: NavItem[];
}

export default function AdminSidebar({ locale }: AdminSidebarProps) {
  const pathname = usePathname();
  const isKk = locale === 'kk';

  const sections: NavSection[] = [
    {
      title_kk: 'Шолу',
      title_ru: 'Обзор',
      items: [
        { href: `/${locale}/admin`, label_kk: 'Басқару тақтасы', label_ru: 'Дашборд', Icon: LayoutDashboard },
        { href: `/${locale}/admin/analytics`, label_kk: 'Аналитика', label_ru: 'Аналитика', Icon: LineChart },
      ],
    },
    {
      title_kk: 'Контент',
      title_ru: 'Контент',
      items: [
        { href: `/${locale}/admin/lessons`, label_kk: 'Сабақтар', label_ru: 'Уроки', Icon: BookOpen },
        { href: `/${locale}/admin/tests`, label_kk: 'Тест сұрақтары', label_ru: 'Тесты', Icon: CheckSquare },
        { href: `/${locale}/admin/grammar`, label_kk: 'Грамматика ережелері', label_ru: 'Правила грамматики', Icon: Scale },
        { href: `/${locale}/admin/editor`, label_kk: 'Жаңалықтар (редактор)', label_ru: 'Новости (редактор)', Icon: PenSquare },
        // /admin/news — альтернативный табличный вид, убран из навигации чтобы не дублировать редактор.
        // Доступен по прямой ссылке для быстрой модерации без TipTap-формы.
        { href: `/${locale}/admin/events`, label_kk: 'Іс-шаралар', label_ru: 'Мероприятия', Icon: CalendarDays },
        { href: `/${locale}/admin/banners`, label_kk: 'Баннерлер', label_ru: 'Баннеры', Icon: ImageIcon },
        { href: `/${locale}/admin/media`, label_kk: 'Медиатека', label_ru: 'Медиатека', Icon: FileVideo },
        { href: `/${locale}/admin/departments`, label_kk: 'Бөлімдер', label_ru: 'Отделы', Icon: Building2 },
        { href: `/${locale}/admin/staff`, label_kk: 'Қызметкерлер', label_ru: 'Сотрудники', Icon: Briefcase },
        { href: `/${locale}/admin/rules`, label_kk: 'Ереже құжаттары', label_ru: 'Правила-документы', Icon: ScrollText },
        { href: `/${locale}/admin/history`, label_kk: 'Орталық тарихы', label_ru: 'История центра', Icon: BookMarked },
      ],
    },
    {
      title_kk: 'Қауымдастық',
      title_ru: 'Сообщество',
      items: [
        { href: `/${locale}/admin/users`, label_kk: 'Пайдаланушылар', label_ru: 'Пользователи', Icon: Users },
      ],
    },
    {
      title_kk: 'Жүйе',
      title_ru: 'Система',
      items: [
        { href: `/${locale}/admin/settings`, label_kk: 'Баптаулар', label_ru: 'Настройки сайта', Icon: Settings },
        { href: `/${locale}/admin/ai-usage`, label_kk: 'AI квоталары', label_ru: 'Квоты AI', Icon: Activity },
        { href: `/${locale}/admin/audit`, label_kk: 'Аудит журналы', label_ru: 'Журнал аудита', Icon: ShieldCheck },
      ],
    },
  ];

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-gray-200 flex flex-col">
      <Link href={`/${locale}`} className="flex items-center gap-3 px-5 py-5 border-b border-gray-100">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-teal-600 to-teal-800 flex items-center justify-center shadow-sm">
          <span className="text-white font-bold">Т</span>
        </div>
        <div>
          <div className="font-bold text-gray-900 leading-tight">Тіл-құрал</div>
          <div className="text-[11px] text-gray-500">{isKk ? 'Әкімші панелі' : 'Админ-панель'}</div>
        </div>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {sections.map((section) => (
          <div key={section.title_ru}>
            <div className="px-3 text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1">
              {isKk ? section.title_kk : section.title_ru}
            </div>
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const active = pathname === item.href;
                const { Icon } = item;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                      active
                        ? 'bg-teal-50 text-teal-800 font-medium'
                        : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900',
                    )}
                  >
                    <Icon size={18} strokeWidth={active ? 2.25 : 1.75} className={active ? 'text-teal-700' : 'text-gray-400'} />
                    <span>{isKk ? item.label_kk : item.label_ru}</span>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-3 py-4 border-t border-gray-100">
        <Link
          href={`/${locale}`}
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900"
        >
          <Home size={18} strokeWidth={1.75} className="text-gray-400" />
          <span>{isKk ? 'Сайтқа оралу' : 'На сайт'}</span>
        </Link>
      </div>
    </aside>
  );
}
