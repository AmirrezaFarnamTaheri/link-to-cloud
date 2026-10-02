import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { originOf, setState } from "@/lib/session";

const SCOPES = "account_info.read files.content.write files.metadata.read";

export async function GET(req: Request) {
  const clientId = process.env.DROPBOX_CLIENT_ID;
  if (!clientId) return NextResponse.redirect(new URL("/?error=dropbox_not_configured", originOf(req)));
  const state = crypto.randomBytes(16).toString("hex");
  await setState("dropbox_state", state);
  const url = new URL("https://www.dropbox.com/oauth2/authorize");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", `${originOf(req)}/api/auth/dropbox/callback`);
  url.searchParams.set("token_access_type", "offline");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}
