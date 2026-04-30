"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  LayoutDashboard, Users, Settings, LogOut, FileText, Newspaper,
  Image as ImageIcon, Tag as TagIcon, FolderTree, Sparkles, Layers,
  MessageCircle, Share2, Send, CalendarClock, BarChart3, BookOpen, AlertTriangle,
  Target,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type AdminUser = { email: string; name: string; role: string };

const NAV: Array<{
  group: string;
  items: Array<{ href: string; label: string; icon: React.ComponentType<{ size?: number }> }>;
}> = [
  {
    group: "Обзор",
    items: [
      { href: "/admin", label: "Сводка", icon: LayoutDashboard },
      { href: "/admin/doc", label: "Живой документ", icon: BookOpen },
      { href: "/admin/leads", label: "Лиды", icon: Users },
      { href: "/admin/whatsapp", label: "WhatsApp", icon: MessageCircle },
    ],
  },
  {
    group: "Контент",
    items: [
      { href: "/admin/content", label: "Лендинг", icon: Layers },
      { href: "/admin/pages", label: "Страницы", icon: FileText },
      { href: "/admin/blog", label: "Блог", icon: Newspaper },
      { href: "/admin/categories", label: "Категории", icon: FolderTree },
      { href: "/admin/tags", label: "Теги", icon: TagIcon },
      { href: "/admin/media", label: "Медиа", icon: ImageIcon },
    ],
  },
  {
    group: "Публикации",
    items: [
      { href: "/admin/social", label: "Каналы", icon: Share2 },
      { href: "/admin/social/publications", label: "История публикаций", icon: Send },
      { href: "/admin/scheduler", label: "Расписание", icon: CalendarClock },
      { href: "/admin/plan", label: "План роста", icon: Target },
    ],
  },
  {
    group: "Аналитика",
    items: [
      { href: "/admin/analytics", label: "Аналитика", icon: BarChart3 },
      { href: "/admin/agents", label: "C-Suite", icon: Users },
      { href: "/admin/ai-usage", label: "AI расходы", icon: Sparkles },
    ],
  },
  {
    group: "Настройки",
    items: [
      { href: "/admin/settings", label: "Настройки", icon: Settings },
      { href: "/admin/logs", label: "Логи системы", icon: AlertTriangle },
    ],
  },
];

export function AdminShell({ user, children }: { user: AdminUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      toast.success("Выход выполнен");
      router.push("/admin/login");
      router.refresh();
    } catch {
      toast.error("Ошибка");
    }
  };

  const initials = user.name
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const breadcrumb = pathname === "/admin"
    ? "Dashboard"
    : pathname.replace("/admin/", "").split("/")[0].replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="min-h-screen bg-black text-white flex">
      <aside className="hidden md:flex w-64 shrink-0 flex-col border-r border-white/5 bg-neutral-950 sticky top-0 h-screen overflow-y-auto">
        <div className="p-6 border-b border-white/5">
          <Link href="/admin" className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center text-white font-black">
              TK
            </div>
            <div>
              <div className="text-sm font-bold">Technokod</div>
              <div className="text-[10px] uppercase tracking-widest text-neutral-500">Admin</div>
            </div>
          </Link>
        </div>
        <nav className="flex-1 p-3 space-y-4">
          {NAV.map((group) => (
            <div key={group.group}>
              <div className="px-3 mb-1.5 text-[10px] uppercase tracking-widest text-neutral-600 font-semibold">
                {group.group}
              </div>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const active =
                    pathname === item.href ||
                    (item.href !== "/admin" && pathname.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-all relative",
                        active
                          ? "bg-blue-500/10 text-white"
                          : "text-neutral-400 hover:text-white hover:bg-white/5",
                      )}
                    >
                      {active && (
                        <span className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-5 rounded-r bg-blue-500" />
                      )}
                      <Icon size={16} />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>
        <div className="p-4 border-t border-white/5">
          <button
            onClick={logout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium text-neutral-400 hover:text-white hover:bg-white/5 transition-all"
          >
            <LogOut size={18} />
            Выйти
          </button>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 border-b border-white/5 bg-neutral-950/80 backdrop-blur sticky top-0 z-20 flex items-center justify-between px-6">
          <div className="text-sm text-neutral-400">{breadcrumb}</div>
          <div className="flex items-center gap-3">
            <div className="text-right hidden sm:block">
              <div className="text-sm font-semibold">{user.name}</div>
              <div className="text-[10px] uppercase tracking-widest text-neutral-500">{user.role}</div>
            </div>
            <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center font-bold text-sm">
              {initials || "TK"}
            </div>
          </div>
        </header>
        <main className="flex-1 p-6 md:p-8">{children}</main>
      </div>
    </div>
  );
}
