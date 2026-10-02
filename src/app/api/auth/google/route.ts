import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { originOf, setState } from "@/lib/session";

export async function GET(req: Request) {
  const id = process.env.GOOGLE_CLIENT_ID;
  if (!id) return NextResponse.redirect(new URL("/?error=google_not_configured", originOf(req)));
  const state = crypto.randomBytes(16).toString("hex");
  await setState("g_state", state);
  const u = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", `${originOf(req)}/api/auth/google/callback`);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("scope", "openid email https://www.googleapis.com/auth/drive.file");
  u.searchParams.set("access_type", "offline"); // refresh token => stay signed in
  u.searchParams.set("prompt", "consent select_account");
  u.searchParams.set("state", state);
  return NextResponse.redirect(u);
}
