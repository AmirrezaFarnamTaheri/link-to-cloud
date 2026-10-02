import { NextResponse } from "next/server";
import { getGoogleAuth } from "@/lib/google";
import { googleOwner, githubOwner } from "@/lib/owners";
import { getSession } from "@/lib/session";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const github = session.github && githubOwner(session.github) ? session.github : null;
  const googleAuth = session.google ? await getGoogleAuth() : null;
  const google = googleAuth && googleOwner(googleAuth) ? googleAuth : null;
  const body: SessionInfo = {
    github: github ? { login: github.login, via: github.via } : null,
    google: google ? { email: google.email } : null,
    config: {
      githubOAuth: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      googleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
