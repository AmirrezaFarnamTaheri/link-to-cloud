import { bigint, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/** One row per attempted transfer; current owner keys use immutable provider IDs, with legacy keys on old rows. */
export const transfers = pgTable(
  "transfers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    owner: text("owner").notNull(),
    target: text("target").notNull(),
    status: text("status").notNull(),
    fileName: text("file_name").notNull(),
    sourceUrl: text("source_url").notNull(),
    location: text("location"),
    resultUrl: text("result_url"),
    bytes: bigint("bytes", { mode: "number" }),
    sha256: text("sha256"),
    error: text("error"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("transfers_owner_idx").on(t.owner, t.createdAt)],
);
