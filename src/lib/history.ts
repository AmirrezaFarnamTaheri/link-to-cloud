import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import { transfers } from "@/db/schema";
import { sql } from "drizzle-orm";

let ready: Promise<void> | null = null;

/** Idempotent safety net so history works even on a database that was never `drizzle-kit push`ed. */
function ensureTable() {
  ready ??= db
    .execute(
      sql`CREATE TABLE IF NOT EXISTS transfers (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        owner text NOT NULL,
        target text NOT NULL,
        status text NOT NULL,
        file_name text NOT NULL,
        source_url text NOT NULL,
        location text,
        result_url text,
        bytes bigint,
        sha256 text,
        error text,
        duration_ms integer,
        created_at timestamptz NOT NULL DEFAULT now()
      )`,
    )
    .then(() => db.execute(sql`CREATE INDEX IF NOT EXISTS transfers_owner_idx ON transfers (owner, created_at)`))
    .then(() => undefined)
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

/** Strip credentials, query string and fragment — signed URLs often carry secrets. */
export function sanitizeUrl(link: string): string {
  try {
    const u = new URL(link);
    return `${u.origin}${u.pathname}`;
  } catch {
    return "invalid-url";
  }
}

export type NewTransfer = typeof transfers.$inferInsert;

export async function recordTransfer(row: NewTransfer) {
  try {
    await ensureTable();
    await db.insert(transfers).values({ ...row, sourceUrl: sanitizeUrl(row.sourceUrl) });
  } catch (e) {
    console.error("history insert failed", e);
  }
}

export async function listTransfers(owners: string[], limit = 40) {
  if (!owners.length) return [];
  await ensureTable();
  return db.select().from(transfers).where(inArray(transfers.owner, owners)).orderBy(desc(transfers.createdAt)).limit(limit);
}

export async function clearTransfers(owners: string[]) {
  if (!owners.length) return;
  await ensureTable();
  await db.delete(transfers).where(inArray(transfers.owner, owners));
}
