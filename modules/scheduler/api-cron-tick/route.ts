import { NextResponse } from "next/server";
import { runScheduler } from "@/lib/scheduler";

/**
 * External-cron fallback. Protected by CRON_SECRET header.
 * Invoke with:  curl -H "X-Cron-Secret: $CRON_SECRET" https://.../api/cron/tick
 */
export async function POST(req: Request): Promise<NextResponse> {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  const received = req.headers.get("x-cron-secret");
  if (received !== expected) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const result = await runScheduler();
  return NextResponse.json({ ok: true, ...result });
}

export async function GET(req: Request): Promise<NextResponse> {
  return POST(req);
}
