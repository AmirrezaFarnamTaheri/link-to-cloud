import { NextResponse } from "next/server";
import { revokeGoogle } from "@/lib/google";
import { clearSession, getSession, saveSession } from "@/lib/session";

export async function POST(req: Request) {
  const { provider } = (await req.json().catch(() => ({}))) as { provider?: "github" | "google" };
  const s = await getSession();
  if (s.google && (!provider || provider === "google")) await revokeGoogle(s.google.refresh ?? s.google.token);
  if (provider) {
    delete s[provider];
    await saveSession(s);
  } else {
    await clearSession();
  }
  return NextResponse.json({ ok: true });
}
