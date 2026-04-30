"use client";

import { motion } from "framer-motion";
import { Users, TrendingUp, Target, Clock } from "lucide-react";
import { timeAgo } from "@/lib/utils";

interface Stats {
  total: number;
  thisWeek: number;
  conversion: number;
  latestAt: Date | string | null;
}

export function DashboardStats({ stats }: { stats: Stats }) {
  const cards = [
    {
      label: "Лидов за неделю",
      value: stats.thisWeek.toString(),
      icon: TrendingUp,
      accent: "from-blue-500/20 to-blue-500/0",
      iconColor: "text-blue-400",
    },
    {
      label: "Всего лидов",
      value: stats.total.toString(),
      icon: Users,
      accent: "from-indigo-500/20 to-indigo-500/0",
      iconColor: "text-indigo-400",
    },
    {
      label: "Конверсия",
      value: `${stats.conversion}%`,
      icon: Target,
      accent: "from-emerald-500/20 to-emerald-500/0",
      iconColor: "text-emerald-400",
    },
    {
      label: "Последний лид",
      value: stats.latestAt ? timeAgo(stats.latestAt) : "—",
      icon: Clock,
      accent: "from-purple-500/20 to-purple-500/0",
      iconColor: "text-purple-400",
    },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c, i) => {
        const Icon = c.icon;
        return (
          <motion.div
            key={c.label}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, delay: i * 0.05 }}
            className="relative overflow-hidden rounded-2xl border border-white/5 bg-neutral-950 p-5"
          >
            <div className={`pointer-events-none absolute -top-10 -right-10 w-40 h-40 rounded-full bg-gradient-to-br ${c.accent} blur-2xl`} />
            <div className="flex items-start justify-between relative">
              <div>
                <div className="text-xs uppercase tracking-widest text-neutral-500 font-bold">
                  {c.label}
                </div>
                <div className="text-3xl font-bold mt-3">{c.value}</div>
              </div>
              <div className={`w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center ${c.iconColor}`}>
                <Icon size={18} />
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
