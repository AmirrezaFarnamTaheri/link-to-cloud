import { NextResponse } from "next/server";
import { revokeGoogle } from "@/lib/google";
import { readJsonObjectRequest } from "@/lib/http";
import { HttpError } from "@/lib/net";
import { clearSession, getSession, isSameOriginRequest, saveSession } from "@/lib/session";

const noStore = { "Cache-Control": "no-store" };

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return json({ error: "Cross-origin request rejected" }, 403);

  let body: Record<string, unknown>;
  try {
    body = await readJsonObjectRequest(req, 1024, "Logout request");
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "Invalid request" }, error instanceof HttpError ? error.status : 400);
  }
  const provider = body.provider;
  if (provider !== undefined && provider !== "github" && provider !== "google") return json({ error: "Invalid provider" }, 400);

  const session = await getSession();
  if (session.google && (!provider || provider === "google")) {
    await revokeGoogle(session.google.refresh ?? session.google.token);
  }
  if (provider) {
    delete session[provider];
    await saveSession(session);
  } else {
    await clearSession();
  }
  return json({ ok: true });
}
