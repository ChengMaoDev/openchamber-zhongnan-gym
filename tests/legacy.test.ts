import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { importLegacyFile } from "../src/service/legacy";
import { Store } from "../src/service/store";
import { cleanupDirectory } from "./cleanup";
import { CURRENT } from "./fixtures";

test("支持早期逐分钟数据库，保留新插件的较新记录", () => {
  const directory = mkdtempSync(join(tmpdir(), "gym-legacy-"));
  const path = join(directory, "legacy.sqlite3");
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE samples(timestamp INTEGER PRIMARY KEY,count INTEGER,payload TEXT)");
  old.prepare("INSERT INTO samples VALUES(?,?,?)").run(CURRENT - 120, 81, "{}");
  old.prepare("INSERT INTO samples VALUES(?,?,?)").run(CURRENT, 81, "{}");
  old.close();
  const store = new Store(join(directory, "history.sqlite3"));
  try {
    store.add({ timestamp: CURRENT - 60, count: 92 }, "{}");
    expect(importLegacyFile(store, path, CURRENT)).toBe(1);
    expect(store.history(CURRENT).map((sample) => sample.count)).toEqual([81, 92]);
    expect(store.status(CURRENT).count).toBe(92);
  } finally {
    store.close();
    cleanupDirectory(directory);
  }
});

test("损坏的旧库不会破坏新库或留下未结束事务", () => {
  const directory = mkdtempSync(join(tmpdir(), "gym-legacy-damaged-"));
  const path = join(directory, "legacy.sqlite3");
  writeFileSync(path, "not a sqlite database");
  const store = new Store(join(directory, "history.sqlite3"));
  try {
    expect(() => importLegacyFile(store, path, CURRENT)).toThrow();
    store.add({ timestamp: CURRENT, count: 92 }, "{}");
    expect(store.status(CURRENT).count).toBe(92);
  } finally {
    store.close();
    cleanupDirectory(directory);
  }
});
