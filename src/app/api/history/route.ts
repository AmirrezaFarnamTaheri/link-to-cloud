import { NextResponse } from "next/server";
import { clearTransfers, listTransfers } from "@/lib/history";
import { sessionOwnerKeys } from "@/lib/owners";
import { getSession, isSameOriginRequest } from "@/lib/session";
import type { HistoryItem } from "@/lib/types";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET() {
  try {
    const rows = await listTransfers(sessionOwnerKeys(await getSession()));
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
    return NextResponse.json({ items }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Transfer history is temporarily unavailable" }, { status: 503, headers: noStore });
  }
}

export async function DELETE(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Cross-origin request rejected" }, { status: 403, headers: noStore });
  try {
    await clearTransfers(sessionOwnerKeys(await getSession()));
    return NextResponse.json({ ok: true }, { headers: noStore });
  } catch {
    return NextResponse.json({ error: "Could not clear transfer history" }, { status: 503, headers: noStore });
  }
}
