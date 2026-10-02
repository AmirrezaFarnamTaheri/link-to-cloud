import { NextResponse } from "next/server";
import { ghHeaders, REPO_RE } from "@/lib/github";
import { getSession } from "@/lib/session";
import { withTimeout } from "@/lib/timeouts";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.github) return NextResponse.json({ error: "Not logged in to GitHub" }, { status: 401, headers: noStore });
  const repo = new URL(req.url).searchParams.get("repo") ?? "";
  if (!REPO_RE.test(repo)) return NextResponse.json({ error: "Invalid repo" }, { status: 400, headers: noStore });

  let response: Response;
  try {
    response = await fetch(`https://api.github.com/repos/${repo}/branches?per_page=100`, {
      headers: ghHeaders(session.github.token),
      signal: withTimeout(undefined, 10_000),
    });
  } catch {
    return NextResponse.json({ error: "Could not reach GitHub" }, { status: 502, headers: noStore });
  }
  if (!response.ok) return NextResponse.json({ error: "Failed to list branches" }, { status: response.status, headers: noStore });
  const list = (await response.json()) as { name: string }[];
  return NextResponse.json({ branches: list.map((branch) => branch.name) }, { headers: noStore });
}
