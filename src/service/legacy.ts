import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { RETENTION_SECONDS } from "../shared/domain";
import type { Store } from "./store";

const legacyRow = z.object({
  timestamp: z.number(),
  observed_until: z.number(),
  count: z.number().int().nonnegative(),
  payload: z.string(),
});

export function importLegacy(store: Store, current: number): number {
  const saved = store.db.prepare("SELECT value FROM settings WHERE name='legacy-imported'").get();
  if (saved) return Number(saved.value);
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.env.LOCALAPPDATA;
  if (!base) return 0;
  const path = join(base, "ZhongnanGym", "ZhongnanGym", "history.sqlite3");
  if (!existsSync(path)) return 0;
  const source = new DatabaseSync(path, { readOnly: true, timeout: 3000 });
  try {
    const rows = source
      .prepare(
        "SELECT timestamp,observed_until,count,payload FROM samples WHERE observed_until>=? ORDER BY timestamp",
      )
      .all(current - RETENTION_SECONDS)
      .map((raw) => legacyRow.parse(raw));
    store.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = store.db.prepare(
        "INSERT OR IGNORE INTO samples(timestamp,observed_until,count,payload) VALUES(?,?,?,?)",
      );
      for (const row of rows)
        insert.run(
          Math.max(row.timestamp, current - RETENTION_SECONDS),
          row.observed_until,
          row.count,
          row.payload,
        );
      store.db.prepare("INSERT INTO settings VALUES('legacy-imported',?)").run(String(rows.length));
      store.db.exec("COMMIT");
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
    return rows.length;
  } finally {
    source.close();
  }
}
