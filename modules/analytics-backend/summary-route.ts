import { getCurrentUser, requireRole } from "@/lib/auth";
import { getMany, getOne } from "@/lib/db";
import { apiError, apiSuccess } from "@/lib/utils";

interface CountRow {
  n: string;
}

interface TopPathRow {
  path: string;
  views: string;
  uniq: string;
}

interface SourceRow {
  source: string;
  sessions: string;
}

interface RecentEventRow {
  id: string;
  type: string;
  path: string | null;
  created_at: string;
}

export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!requireRole(user, ["admin", "editor"])) return apiError("Unauthorized", 401);

    const [
      sessionsToday,
      sessionsWeek,
      sessionsMonth,
      pageviewsTotal,
      pageviewsToday,
      pageviewsWeek,
      pageviewsMonth,
      eventsToday,
      topPaths,
      sourcesRows,
      recentEvents,
    ] = await Promise.all([
      getOne<CountRow>(
        `SELECT COUNT(*)::text AS n FROM analytics_sessions WHERE created_at >= NOW() - INTERVAL '1 day'`
      ),
      getOne<CountRow>(
        `SELECT COUNT(*)::text AS n FROM analytics_sessions WHERE created_at >= NOW() - INTERVAL '7 days'`
      ),
      getOne<CountRow>(
        `SELECT COUNT(*)::text AS n FROM analytics_sessions WHERE created_at >= NOW() - INTERVAL '30 days'`
      ),
      getOne<CountRow>(
        `SELECT COUNT(*)::text AS n FROM analytics_events WHERE type = 'pageview'`
      ),
      getOne<CountRow>(
        `SELECT COUNT(*)::text AS n FROM analytics_events WHERE type = 'pageview' AND created_at >= NOW() - INTERVAL '1 day'`
      ),
      getOne<CountRow>(
        `SELECT COUNT(*)::text AS n FROM analytics_events WHERE type = 'pageview' AND created_at >= NOW() - INTERVAL '7 days'`
      ),
      getOne<CountRow>(
        `SELECT COUNT(*)::text AS n FROM analytics_events WHERE type = 'pageview' AND created_at >= NOW() - INTERVAL '30 days'`
      ),
      getOne<CountRow>(
        `SELECT COUNT(*)::text AS n FROM analytics_events WHERE created_at >= NOW() - INTERVAL '1 day'`
      ),
      getMany<TopPathRow>(
        `SELECT COALESCE(path, '') AS path,
                COUNT(*)::text AS views,
                COUNT(DISTINCT session_key)::text AS uniq
           FROM analytics_events
          WHERE type = 'pageview'
            AND created_at >= NOW() - INTERVAL '7 days'
            AND path IS NOT NULL AND path <> ''
          GROUP BY path
          ORDER BY COUNT(*) DESC
          LIMIT 20`
      ),
      getMany<SourceRow>(
        `SELECT source, COUNT(*)::text AS sessions FROM (
           SELECT CASE
             WHEN utm_source IS NOT NULL AND utm_source <> '' THEN 'utm:' || utm_source
             WHEN referrer IS NOT NULL AND referrer <> '' THEN 'ref:' || SUBSTRING(referrer FROM 1 FOR 80)
             ELSE 'direct'
           END AS source
           FROM analytics_sessions
           WHERE created_at >= NOW() - INTERVAL '7 days'
         ) s
         GROUP BY source
         ORDER BY COUNT(*) DESC
         LIMIT 20`
      ),
      getMany<RecentEventRow>(
        `SELECT id, type, path, created_at::text AS created_at
           FROM analytics_events
          ORDER BY created_at DESC
          LIMIT 50`
      ),
    ]);

    return apiSuccess({
      kpi: {
        sessions_today: Number(sessionsToday?.n ?? 0),
        sessions_week: Number(sessionsWeek?.n ?? 0),
        sessions_month: Number(sessionsMonth?.n ?? 0),
        pageviews_total: Number(pageviewsTotal?.n ?? 0),
        pageviews_today: Number(pageviewsToday?.n ?? 0),
        pageviews_week: Number(pageviewsWeek?.n ?? 0),
        pageviews_month: Number(pageviewsMonth?.n ?? 0),
        events_today: Number(eventsToday?.n ?? 0),
      },
      top_paths: topPaths.map((r) => ({
        path: r.path,
        views: Number(r.views),
        unique_sessions: Number(r.uniq),
      })),
      sources: sourcesRows.map((r) => ({
        source: r.source,
        sessions: Number(r.sessions),
      })),
      recent_events: recentEvents,
    });
  } catch (error) {
    console.error("GET /api/admin/analytics/summary error:", error);
    return apiError("Internal server error", 500);
  }
}
