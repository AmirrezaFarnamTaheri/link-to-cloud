import { NextResponse } from "next/server";
import { getGoogleAuth } from "@/lib/google";
import type { DriveFolder } from "@/lib/types";
import { withTimeout } from "@/lib/timeouts";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

/** With the `drive.file` scope this lists folders created by this app only. */
export async function GET() {
  const google = await getGoogleAuth();
  if (!google) return NextResponse.json({ error: "Not logged in to Google" }, { status: 401, headers: noStore });
  const query = encodeURIComponent("mimeType='application/vnd.google-apps.folder' and trashed=false");
  let response: Response;
  try {
    response = await fetch(
      `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)&orderBy=name&pageSize=100`,
      { headers: { Authorization: `Bearer ${google.token}` }, signal: withTimeout(undefined, 10_000) },
    );
  } catch {
    return NextResponse.json({ error: "Could not reach Google Drive" }, { status: 502, headers: noStore });
  }
  if (!response.ok) return NextResponse.json({ error: "Failed to list folders" }, { status: response.status, headers: noStore });
  const body = (await response.json()) as { files?: DriveFolder[] };
  return NextResponse.json({ folders: body.files ?? [] }, { headers: noStore });
}
