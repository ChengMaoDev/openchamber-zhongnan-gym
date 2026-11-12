import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/service/store";
import { RETENTION_SECONDS } from "../src/shared/domain";
import { cleanupDirectory } from "./cleanup";
import { CURRENT } from "./fixtures";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "gym-merge-"));
  store = new Store(join(directory, "history.sqlite3"));
});
afterEach(() => {
  store.close();
  cleanupDirectory(directory);
});

test("按分钟合并时本机记录优先，重复导入不增加记录", () => {
  store.add({ timestamp: CURRENT - 80, count: 70 }, '{"local":true}');
  store.markRequest(CURRENT - 80);
  const status = store.status(CURRENT);
  const incoming = [{ start: CURRENT - 180, end: CURRENT, count: 90 }];
  expect(store.importHistory(incoming, CURRENT)).toEqual({ added: 3, skipped: 1 });
  expect(
    store
      .history(CURRENT)
      .filter((sample) => Math.floor(sample.timestamp / 60) === Math.floor((CURRENT - 80) / 60)),
  ).toEqual([{ timestamp: CURRENT - 80, count: 70 }]);
  expect(store.status(CURRENT)).toEqual(status);
  expect(store.lastRequest()).toBe(CURRENT - 80);
  const before = store.segments(0, CURRENT);
  expect(store.importHistory(incoming, CURRENT).added).toBe(0);
  expect(store.segments(0, CURRENT)).toEqual(before);
});

test("导入不伪造实时人数或请求时间，随后本机采集可以正常写入", () => {
  store.importHistory([{ start: CURRENT - 60, end: CURRENT, count: 80 }], CURRENT);
  expect(store.status(CURRENT).count).toBeNull();
  expect(store.status(CURRENT).stale).toBe(true);
  expect(store.lastRequest()).toBeNull();
  store.add({ timestamp: CURRENT + 60, count: 80 }, "{}");
  expect(store.status(CURRENT + 60).updatedAt).toBe(CURRENT + 60);
  expect(store.lastRequest()).toBe(CURRENT + 60);
});

test("导入保留缺口，只接受最近30天，连续同值仍压缩存储", () => {
  const cutoff = CURRENT - RETENTION_SECONDS;
  store.importHistory(
    [
      { start: cutoff - 300, end: cutoff - 60, count: 1 },
      { start: cutoff, end: cutoff + 300, count: 2 },
      { start: CURRENT - 3600, end: CURRENT - 1800, count: 30 },
      { start: CURRENT - 600, end: CURRENT, count: 30 },
      { start: CURRENT + 60, end: CURRENT + 300, count: 1 },
    ],
    CURRENT,
  );
  expect(store.segments(0, CURRENT + 300)).toHaveLength(3);
  expect(store.history(CURRENT).some((sample) => sample.timestamp === CURRENT - 1200)).toBe(false);
  expect(
    store
      .history(CURRENT)
      .every((sample) => sample.timestamp >= cutoff && sample.timestamp <= CURRENT),
  ).toBe(true);
});

test("不同采样秒数的记录不会跨过本机分钟合并成覆盖区间", () => {
  store.add({ timestamp: CURRENT - 60, count: 9 }, "{}");
  store.importHistory(
    [
      { start: CURRENT - 61, end: CURRENT - 61, count: 8 },
      { start: CURRENT, end: CURRENT, count: 8 },
    ],
    CURRENT,
  );
  expect(store.history(CURRENT).filter((sample) => sample.timestamp === CURRENT - 60)).toEqual([
    { timestamp: CURRENT - 60, count: 9 },
  ]);
  expect(store.segments(0, CURRENT)).toHaveLength(3);
});

test("合并中任一写入失败时回滚全部新记录", () => {
  store.add({ timestamp: CURRENT - 300, count: 5 }, "{}");
  const before = store.history(CURRENT);
  store.db.exec(
    "CREATE TRIGGER reject_count BEFORE INSERT ON samples WHEN NEW.count=99 BEGIN SELECT RAISE(ABORT,'test rollback'); END",
  );
  expect(() =>
    store.importHistory(
      [
        { start: CURRENT - 120, end: CURRENT - 120, count: 8 },
        { start: CURRENT, end: CURRENT, count: 99 },
      ],
      CURRENT,
    ),
  ).toThrow("test rollback");
  expect(store.history(CURRENT)).toEqual(before);
});
