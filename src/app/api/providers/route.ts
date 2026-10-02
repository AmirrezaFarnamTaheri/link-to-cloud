import { getAllProviders } from "@/lib/providers/registry";

export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json({ providers: getAllProviders() }, { headers: { "Cache-Control": "no-store" } });
}
