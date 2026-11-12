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
import { mergeHistory } from "./history-merge";

const rowSchema = z.object({
  timestamp: z.number(),
  observed_until: z.number(),
  count: z.number(),
});
const errorSchema = z.object({ timestamp: z.number(), error: z.string() });
const resultSchema = z.object({ timestamp: z.number(), error: z.string().nullable() });
const IMPORTED_PAYLOAD = '{"source":"history-import"}';

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
    this.transaction(() => this.writeSample(sample, payload));
  }

  private writeSample(sample: Sample, payload: string): void {
    const raw = this.db.prepare("SELECT * FROM samples ORDER BY timestamp DESC LIMIT 1").get();
    const last = raw ? rowSchema.parse(raw) : null;
    const failed = this.db
      .prepare("SELECT timestamp FROM attempts WHERE timestamp>? AND timestamp<=? LIMIT 1")
      .get(last?.observed_until ?? 0, sample.timestamp);
    if (
      last &&
      raw?.payload !== IMPORTED_PAYLOAD &&
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
    this.saveResult(sample.timestamp, null);
  }

  failure(timestamp: number, error: string): void {
    this.transaction(() => {
      this.db.prepare("INSERT OR REPLACE INTO attempts VALUES(?,?)").run(timestamp, error);
      this.saveResult(timestamp, error);
    });
  }

  private saveResult(timestamp: number, error: string | null): void {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES('last-result',?)")
      .run(JSON.stringify({ timestamp, error }));
  }

  markRequest(timestamp: number): void {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES('last-request',?)")
      .run(String(timestamp));
  }

  lastRequest(): number | null {
    const saved = this.db.prepare("SELECT value FROM settings WHERE name='last-request'").get();
    if (saved) return z.coerce.number().int().nonnegative().parse(saved.value);
    const row = this.db
      .prepare(
        "SELECT max(timestamp) AS stamp FROM (SELECT max(observed_until) AS timestamp FROM samples WHERE payload<>? UNION ALL SELECT max(timestamp) FROM attempts)",
      )
      .get(IMPORTED_PAYLOAD);
    return z.object({ stamp: z.number().nullable() }).parse(row).stamp;
  }

  private transaction(write: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      write();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  prune(current: number): void {
    const cutoff = current - RETENTION_SECONDS;
    this.transaction(() => {
      this.db.prepare("DELETE FROM samples WHERE observed_until<?").run(cutoff);
      this.db
        .prepare("UPDATE samples SET timestamp=? WHERE timestamp<? AND observed_until>=?")
        .run(cutoff, cutoff, cutoff);
      this.db.prepare("DELETE FROM attempts WHERE timestamp<?").run(cutoff);
    });
    this.db.exec("PRAGMA incremental_vacuum(64)");
  }

  segments(start: number, end: number): Segment[] {
    if (start > end) return [];
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

  importHistory(segments: readonly Segment[], current: number) {
    const result = mergeHistory(
      this.segments(current - RETENTION_SECONDS, current),
      segments,
      current,
    );
    this.transaction(() => {
      const insert = this.db.prepare(
        "INSERT INTO samples(timestamp,observed_until,count,payload) VALUES(?,?,?,?)",
      );
      for (const segment of result.segments)
        insert.run(segment.start, segment.end, segment.count, IMPORTED_PAYLOAD);
    });
    return { added: result.added, skipped: result.skipped };
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
    const raw = this.db
      .prepare("SELECT * FROM samples WHERE payload<>? ORDER BY timestamp DESC LIMIT 1")
      .get(IMPORTED_PAYLOAD);
    const last = raw ? rowSchema.parse(raw) : null;
    const failed = this.db.prepare("SELECT * FROM attempts ORDER BY timestamp DESC LIMIT 1").get();
    const failure = failed ? errorSchema.parse(failed) : null;
    let error =
      failure && (!last || failure.timestamp > last.observed_until) ? failure.error : null;
    const saved = this.db.prepare("SELECT value FROM settings WHERE name='last-result'").get();
    if (saved) {
      const result = resultSchema.parse(JSON.parse(z.string().parse(saved.value)));
      if (!last || result.timestamp >= last.observed_until) error = result.error;
    }
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
