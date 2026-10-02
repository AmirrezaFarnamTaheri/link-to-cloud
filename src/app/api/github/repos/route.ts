import { NextResponse } from "next/server";
import { ghHeaders } from "@/lib/github";
import { getSession } from "@/lib/session";
import type { Repo } from "@/lib/types";

export const dynamic = "force-dynamic";

type GhRepo = { full_name: string; private: boolean; default_branch: string; archived?: boolean; permissions?: { push?: boolean } };

export async function GET() {
  const s = await getSession();
  if (!s.github) return NextResponse.json({ error: "Not logged in to GitHub" }, { status: 401 });
  const out: Repo[] = [];
  for (let page = 1; page <= 3; page++) {
    const r = await fetch(
      `https://api.github.com/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`,
      { headers: ghHeaders(s.github.token) },
    );
    if (!r.ok) {
      if (page === 1) return NextResponse.json({ error: "Failed to list repos" }, { status: r.status });
      break;
    }
    const batch = (await r.json()) as GhRepo[];
    for (const x of batch) {
      if (x.archived || x.permissions?.push === false) continue;
      out.push({ name: x.full_name, private: x.private, defaultBranch: x.default_branch });
    }
    if (batch.length < 100) break;
  }
  return NextResponse.json({ repos: out });
}
