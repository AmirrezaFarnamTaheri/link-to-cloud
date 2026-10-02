import { NextResponse } from "next/server";
import { getGoogleAuth } from "@/lib/google";
import type { DriveFolder } from "@/lib/types";

export const dynamic = "force-dynamic";

/** With the `drive.file` scope this lists folders created by this app only. */
export async function GET() {
  const g = await getGoogleAuth();
  if (!g) return NextResponse.json({ error: "Not logged in to Google" }, { status: 401 });
  const q = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false");
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&orderBy=name&pageSize=100`,
    { headers: { Authorization: `Bearer ${g.token}` } },
  );
  if (!r.ok) return NextResponse.json({ error: "Failed to list folders" }, { status: r.status });
  const j = (await r.json()) as { files?: DriveFolder[] };
  return NextResponse.json({ folders: j.files ?? [] });
}
