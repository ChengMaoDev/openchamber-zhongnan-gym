import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import {
  dayStart,
  expand,
  RETENTION_SECONDS,
  type Sample,
  type Segment,
  type Status,
} from "../shared/domain";

const rowSchema = z.object({
  timestamp: z.number(),
  observed_until: z.number(),
  count: z.number(),
});
const errorSchema = z.object({ timestamp: z.number(), error: z.string() });

export class Store {
  readonly db: DatabaseSync;

  constructor(readonly path: string) {
    mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path, { timeout: 3000 });
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA auto_vacuum=INCREMENTAL;
      CREATE TABLE IF NOT EXISTS samples (
        timestamp INTEGER PRIMARY KEY, observed_until INTEGER NOT NULL,
        count INTEGER NOT NULL CHECK(count>=0), payload TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS attempts (timestamp INTEGER PRIMARY KEY, error TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (name TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
  }

  add(sample: Sample, payload: string): void {
    const raw = this.db.prepare("SELECT * FROM samples ORDER BY timestamp DESC LIMIT 1").get();
    const last = raw ? rowSchema.parse(raw) : null;
    const failed = this.db
      .prepare("SELECT timestamp FROM attempts WHERE timestamp>? AND timestamp<=? LIMIT 1")
      .get(last?.observed_until ?? 0, sample.timestamp);
    if (
      last &&
      last.count === sample.count &&
      sample.timestamp - last.observed_until >= 0 &&
      sample.timestamp - last.observed_until <= 90 &&
      !failed
    ) {
      this.db
        .prepare("UPDATE samples SET observed_until=? WHERE timestamp=?")
        .run(sample.timestamp, last.timestamp);
    } else {
      this.db
        .prepare(
          "INSERT OR REPLACE INTO samples(timestamp,observed_until,count,payload) VALUES(?,?,?,?)",
        )
        .run(sample.timestamp, sample.timestamp, sample.count, payload);
    }
  }

  failure(timestamp: number, error: string): void {
    this.db.prepare("INSERT OR REPLACE INTO attempts VALUES(?,?)").run(timestamp, error);
  }

  prune(current: number): void {
    const cutoff = current - RETENTION_SECONDS;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db.prepare("DELETE FROM samples WHERE observed_until<?").run(cutoff);
      this.db
        .prepare("UPDATE samples SET timestamp=? WHERE timestamp<? AND observed_until>=?")
        .run(cutoff, cutoff, cutoff);
      this.db.prepare("DELETE FROM attempts WHERE timestamp<?").run(cutoff);
      this.db.exec("COMMIT; PRAGMA incremental_vacuum(64)");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  segments(start: number, end: number): Segment[] {
    return this.db
      .prepare(
        "SELECT timestamp,observed_until,count FROM samples WHERE observed_until>=? AND timestamp<=? ORDER BY timestamp",
      )
      .all(start, end)
      .map((raw) => {
        const row = rowSchema.parse(raw);
        return {
          start: Math.max(start, row.timestamp),
          end: Math.min(end, row.observed_until),
          count: row.count,
        };
      });
  }

  history(current: number): Sample[] {
    return expand(this.segments(current - RETENTION_SECONDS, current));
  }

  day(day: string, current: number): Sample[] {
    return expand(
      this.segments(
        Math.max(dayStart(day), current - RETENTION_SECONDS),
        Math.min(dayStart(day) + 86399, current),
      ),
    );
  }

  status(current: number): Status {
    const raw = this.db.prepare("SELECT * FROM samples ORDER BY timestamp DESC LIMIT 1").get();
    const last = raw ? rowSchema.parse(raw) : null;
    const failed = this.db.prepare("SELECT * FROM attempts ORDER BY timestamp DESC LIMIT 1").get();
    const failure = failed ? errorSchema.parse(failed) : null;
    const error =
      failure && (!last || failure.timestamp > last.observed_until) ? failure.error : null;
    return {
      count: last?.count ?? null,
      updatedAt: last?.observed_until ?? null,
      stale: !last || current - last.observed_until > 180 || error !== null,
      error,
    };
  }

  close(): void {
    this.db.close();
  }
}
