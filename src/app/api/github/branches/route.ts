import { NextResponse } from "next/server";
import { ghHeaders, REPO_RE } from "@/lib/github";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s.github) return NextResponse.json({ error: "Not logged in to GitHub" }, { status: 401 });
  const repo = new URL(req.url).searchParams.get("repo") ?? "";
  if (!REPO_RE.test(repo)) return NextResponse.json({ error: "Invalid repo" }, { status: 400 });
  const r = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, { headers: ghHeaders(s.github.token) });
  if (!r.ok) return NextResponse.json({ error: "Failed to list branches" }, { status: r.status });
  const list = (await r.json()) as { name: string }[];
  return NextResponse.json({ branches: list.map((b) => b.name) });
}
