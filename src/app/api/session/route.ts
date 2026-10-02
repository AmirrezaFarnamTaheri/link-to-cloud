import { NextResponse } from "next/server";
import { getDropboxAuth } from "@/lib/dropbox";
import { getGoogleAuth } from "@/lib/google";
import { getOneDriveAuth } from "@/lib/onedrive";
import { googleOwner, githubOwner, oneDriveOwner, dropboxOwner } from "@/lib/owners";
import { getSession } from "@/lib/session";
import type { SessionInfo } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  const github = session.github && githubOwner(session.github) ? session.github : null;
  const googleAuth = session.google ? await getGoogleAuth() : null;
  const google = googleAuth && googleOwner(googleAuth) ? googleAuth : null;
  const oneDriveAuth = session.onedrive ? await getOneDriveAuth() : null;
  const oneDrive = oneDriveAuth && oneDriveOwner(oneDriveAuth) ? oneDriveAuth : null;
  const dropboxAuth = session.dropbox ? await getDropboxAuth() : null;
  const dropbox = dropboxAuth && dropboxOwner(dropboxAuth) ? dropboxAuth : null;
  const connectedProviders = [
    ...(github ? ["github"] : []),
    ...(google ? ["drive"] : []),
    ...(oneDrive ? ["onedrive"] : []),
    ...(dropbox ? ["dropbox"] : []),
  ];
  const body: SessionInfo = {
    github: github ? { login: github.login, via: github.via } : null,
    google: google ? { email: google.email } : null,
    onedrive: oneDrive ? { name: oneDrive.name } : null,
    dropbox: dropbox ? { name: dropbox.name } : null,
    connectedProviders,
    config: {
      githubOAuth: !!(process.env.GITHUB_CLIENT_ID && process.env.GITHUB_CLIENT_SECRET),
      googleOAuth: !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
      oneDriveOAuth: !!(process.env.ONEDRIVE_CLIENT_ID && process.env.ONEDRIVE_CLIENT_SECRET),
      dropboxOAuth: !!(process.env.DROPBOX_CLIENT_ID && process.env.DROPBOX_CLIENT_SECRET),
    },
  };
  return NextResponse.json(body, { headers: { "Cache-Control": "no-store" } });
}
