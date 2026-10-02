import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { originOf, setState } from "@/lib/session";

export async function GET(req: Request) {
  const id = process.env.GITHUB_CLIENT_ID;
  if (!id) return NextResponse.redirect(new URL("/?error=github_not_configured", originOf(req)));
  const state = crypto.randomBytes(16).toString("hex");
  await setState("gh_state", state);
  const u = new URL("https://github.com/login/oauth/authorize");
  u.searchParams.set("client_id", id);
  u.searchParams.set("redirect_uri", `${originOf(req)}/api/auth/github/callback`);
  u.searchParams.set("scope", "repo");
  u.searchParams.set("state", state);
  return NextResponse.redirect(u);
}
