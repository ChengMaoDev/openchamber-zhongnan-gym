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
  if (saved) return z.coerce.number().int().nonnegative().parse(saved.value);
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.env.LOCALAPPDATA;
  if (!base) {
    store.db.prepare("INSERT INTO settings VALUES('legacy-imported','0')").run();
    return 0;
  }
  const path = join(base, "ZhongnanGym", "ZhongnanGym", "history.sqlite3");
  if (!existsSync(path)) {
    store.db.prepare("INSERT INTO settings VALUES('legacy-imported','0')").run();
    return 0;
  }
  return importLegacyFile(store, path, current);
}

export function importLegacyFile(store: Store, path: string, current: number): number {
  const source = new DatabaseSync(path, { readOnly: true, timeout: 3000 });
  try {
    const columns = source.prepare("PRAGMA table_info(samples)").all();
    const compressed = columns.some((column) => column.name === "observed_until");
    const end = compressed ? "observed_until" : "timestamp";
    const rows = source
      .prepare(
        `SELECT timestamp,${end} AS observed_until,count,payload FROM samples WHERE ${end}>=? ORDER BY timestamp`,
      )
      .all(current - RETENTION_SECONDS)
      .map((raw) => legacyRow.parse(raw));
    store.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = store.db.prepare(
        "INSERT OR IGNORE INTO samples(timestamp,observed_until,count,payload) VALUES(?,?,?,?)",
      );
      const first = z
        .object({ stamp: z.number().nullable() })
        .parse(store.db.prepare("SELECT min(timestamp) AS stamp FROM samples").get()).stamp;
      let imported = 0;
      for (const row of rows) {
        const start = Math.max(row.timestamp, current - RETENTION_SECONDS);
        const until = Math.min(row.observed_until, current, first === null ? current : first - 1);
        if (start > until) continue;
        insert.run(start, until, row.count, row.payload);
        imported++;
      }
      store.db
        .prepare("INSERT OR REPLACE INTO settings VALUES('legacy-imported',?)")
        .run(String(imported));
      store.db.exec("COMMIT");
      return imported;
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
  } finally {
    source.close();
  }
}
