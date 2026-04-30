"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  FunnelChart,
  Funnel,
  LabelList,
  Cell,
} from "recharts";

interface SummaryResponse {
  range: { from: string; to: string };
  totals: {
    pageViews: number;
    leads: number;
    articleViews: number;
    ctaClicks: number;
    sessions: number;
    conversionRate: number;
  };
  funnel: { pageViews: number; articleViews: number; ctaClicks: number; leads: number };
  series: { date: string; visits: number; leads: number }[];
  topPaths: { path: string; count: number }[];
  topArticles: { articleId: string; count: number }[];
  utm: { source: string | null; medium: string | null; campaign: string | null; visits: number; leads: number }[];
}

const CHART_STROKE = "#737373";
const CHART_GRID = "#262626";
const FUNNEL_COLORS = ["#60a5fa", "#34d399", "#fbbf24", "#f87171"];

function isoDaysAgo(n: number): string {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
}

export function AnalyticsDashboard() {
  const [from, setFrom] = useState<string>(isoDaysAgo(30));
  const [to, setTo] = useState<string>(new Date().toISOString());
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ from, to });
        const res = await fetch(`/api/analytics/summary?${params.toString()}`);
        const json = (await res.json()) as SummaryResponse;
        setData(json);
      } finally {
        setLoading(false);
      }
    })();
  }, [from, to]);

  const funnelData = useMemo(() => {
    if (!data) return [];
    const f = data.funnel;
    return [
      { name: "Просмотры", value: f.pageViews, fill: FUNNEL_COLORS[0] },
      { name: "Статьи", value: f.articleViews, fill: FUNNEL_COLORS[1] },
      { name: "CTA", value: f.ctaClicks, fill: FUNNEL_COLORS[2] },
      { name: "Лиды", value: f.leads, fill: FUNNEL_COLORS[3] },
    ];
  }, [data]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="text-xs text-neutral-500 block mb-1">С</label>
          <input
            type="date"
            value={from.slice(0, 10)}
            onChange={(e) => setFrom(new Date(e.target.value).toISOString())}
            className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="text-xs text-neutral-500 block mb-1">По</label>
          <input
            type="date"
            value={to.slice(0, 10)}
            onChange={(e) => setTo(new Date(e.target.value).toISOString())}
            className="bg-neutral-900 border border-neutral-800 rounded-lg px-3 py-2 text-sm"
          />
        </div>
        <div className="flex gap-2 ml-auto">
          {[7, 30, 90].map((days) => (
            <button
              key={days}
              onClick={() => {
                setFrom(isoDaysAgo(days));
                setTo(new Date().toISOString());
              }}
              className="px-3 py-2 text-xs rounded-lg border border-neutral-800 hover:border-neutral-600"
            >
              {days} дней
            </button>
          ))}
        </div>
      </div>

      {loading || !data ? (
        <div className="text-neutral-500">Загрузка…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <Kpi label="Просмотры" value={data.totals.pageViews} />
            <Kpi label="Сессии" value={data.totals.sessions} />
            <Kpi label="Просмотры статей" value={data.totals.articleViews} />
            <Kpi label="CTA клики" value={data.totals.ctaClicks} />
            <Kpi label="Лиды" value={data.totals.leads} suffix={`${(data.totals.conversionRate * 100).toFixed(2)}% CR`} />
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
            <h3 className="font-semibold mb-4">Посещения и лиды</h3>
            <div style={{ width: "100%", height: 280 }}>
              <ResponsiveContainer>
                <LineChart data={data.series}>
                  <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke={CHART_STROKE} fontSize={12} />
                  <YAxis stroke={CHART_STROKE} fontSize={12} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #262626", borderRadius: 8 }}
                  />
                  <Line type="monotone" dataKey="visits" stroke="#60a5fa" strokeWidth={2} dot={false} />
                  <Line type="monotone" dataKey="leads" stroke="#f87171" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
              <h3 className="font-semibold mb-4">Воронка</h3>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <FunnelChart>
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #262626", borderRadius: 8 }}
                    />
                    <Funnel dataKey="value" data={funnelData} isAnimationActive>
                      <LabelList position="right" fill="#fff" stroke="none" dataKey="name" />
                      {funnelData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Funnel>
                  </FunnelChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
              <h3 className="font-semibold mb-4">Топ страниц</h3>
              <div style={{ width: "100%", height: 280 }}>
                <ResponsiveContainer>
                  <BarChart data={data.topPaths} layout="vertical">
                    <CartesianGrid stroke={CHART_GRID} strokeDasharray="3 3" />
                    <XAxis type="number" stroke={CHART_STROKE} fontSize={12} />
                    <YAxis type="category" dataKey="path" stroke={CHART_STROKE} fontSize={11} width={130} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "#0a0a0a", border: "1px solid #262626", borderRadius: 8 }}
                    />
                    <Bar dataKey="count" fill="#60a5fa" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
            <h3 className="font-semibold mb-4">Топ статей</h3>
            {data.topArticles.length === 0 ? (
              <div className="text-neutral-500 text-sm">Нет данных</div>
            ) : (
              <ul className="divide-y divide-neutral-800">
                {data.topArticles.map((a) => (
                  <li key={a.articleId} className="flex justify-between py-2 text-sm">
                    <span className="font-mono text-xs text-neutral-400">{a.articleId}</span>
                    <span className="font-semibold">{a.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5">
            <h3 className="font-semibold mb-4">UTM-атрибуция</h3>
            <table className="w-full text-sm">
              <thead className="text-left text-neutral-500 text-xs">
                <tr>
                  <th className="pb-2 font-medium">Source</th>
                  <th className="pb-2 font-medium">Medium</th>
                  <th className="pb-2 font-medium">Campaign</th>
                  <th className="pb-2 font-medium text-right">Визитов</th>
                  <th className="pb-2 font-medium text-right">Лидов</th>
                </tr>
              </thead>
              <tbody>
                {data.utm.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="text-neutral-500 text-center py-4">
                      Нет UTM-данных
                    </td>
                  </tr>
                ) : (
                  data.utm.map((row, i) => (
                    <tr key={i} className="border-t border-neutral-800">
                      <td className="py-2">{row.source ?? "—"}</td>
                      <td className="py-2">{row.medium ?? "—"}</td>
                      <td className="py-2">{row.campaign ?? "—"}</td>
                      <td className="py-2 text-right">{row.visits}</td>
                      <td className="py-2 text-right">{row.leads}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

function Kpi({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-4">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value.toLocaleString("ru-RU")}</div>
      {suffix && <div className="text-xs text-neutral-400 mt-1">{suffix}</div>}
    </div>
  );
}
