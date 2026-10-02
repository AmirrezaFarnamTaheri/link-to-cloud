import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { originOf, setState } from "@/lib/session";

const SCOPE = "openid profile offline_access User.Read Files.ReadWrite";

export async function GET(req: Request) {
  const clientId = process.env.ONEDRIVE_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(new URL("/?error=onedrive_not_configured", originOf(req)));
  const state = crypto.randomBytes(16).toString("hex");
  await setState("onedrive_state", state);
  const url = new URL("https://login.microsoftonline.com/common/oauth2/v2.0/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${originOf(req)}/api/auth/onedrive/callback`);
  url.searchParams.set("response_mode", "query");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
