import { NextResponse } from "next/server";
import { getGoogleAuth } from "@/lib/google";
import { getSession } from "@/lib/session";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const s = await getSession();
  const g = s.google ? await getGoogleAuth() : null;
  const body: SessionInfo = {
    github: s.github ? { login: s.github.login, via: s.github.via } : null,
    google: g ? { email: g.email } : null,
    config: {
      githubOAuth: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      googleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
