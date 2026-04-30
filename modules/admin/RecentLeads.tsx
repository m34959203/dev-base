"use client";

import Link from "next/link";
import { StatusBadge } from "./StatusBadge";
import { timeAgo } from "@/lib/utils";

interface Lead {
  id: string;
  name: string;
  phone: string;
  email: string;
  status: string;
  createdAt: string;
}

export function RecentLeads({ leads }: { leads: Lead[] }) {
  return (
    <div className="rounded-2xl border border-white/5 bg-neutral-950 overflow-hidden">
      <div className="p-5 border-b border-white/5 flex items-center justify-between">
        <h2 className="font-semibold">Последние лиды</h2>
        <Link href="/admin/leads" className="text-xs text-blue-400 hover:text-blue-300 font-semibold">
          Все лиды →
        </Link>
      </div>
      {leads.length === 0 ? (
        <div className="p-10 text-center text-neutral-500 text-sm">Пока нет лидов</div>
      ) : (
        <ul className="divide-y divide-white/5">
          {leads.map((l) => (
            <li key={l.id}>
              <Link
                href={`/admin/leads?id=${l.id}`}
                className="flex items-center gap-4 px-5 py-4 hover:bg-white/5 transition-colors"
              >
                <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-white/5 flex items-center justify-center text-xs font-bold">
                  {l.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{l.name}</div>
                  <div className="text-xs text-neutral-500 truncate">
                    {l.phone}
                    {l.email ? ` · ${l.email}` : ""}
                  </div>
                </div>
                <StatusBadge status={l.status} />
                <div className="text-xs text-neutral-500 w-28 text-right">{timeAgo(l.createdAt)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
