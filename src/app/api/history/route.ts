import { NextResponse } from "next/server";
import { getGoogleAuth } from "@/lib/google";
import { clearTransfers, listTransfers } from "@/lib/history";
import { getSession } from "@/lib/session";
import type { HistoryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

async function owners(): Promise<string[]> {
  const s = await getSession();
  const out: string[] = [];
  if (s.github) out.push(`github:${s.github.login}`);
  const g = s.google ? await getGoogleAuth() : null;
  if (g) out.push(`google:${g.email}`);
  return out;
}

export async function GET() {
  try {
    const rows = await listTransfers(await owners());
    const items: HistoryItem[] = rows.map((r) => ({
      id: r.id,
      target: r.target as HistoryItem["target"],
      status: r.status as HistoryItem["status"],
      fileName: r.fileName,
      sourceUrl: r.sourceUrl,
      location: r.location,
      resultUrl: r.resultUrl,
      bytes: r.bytes,
      sha256: r.sha256,
      error: r.error,
      durationMs: r.durationMs,
      createdAt: r.createdAt.toISOString(),
    }));
    return NextResponse.json({ items });
  } catch {
    return NextResponse.json({ items: [] });
  }
}

export async function DELETE() {
  await clearTransfers(await owners());
  return NextResponse.json({ ok: true });
}
