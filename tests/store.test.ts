import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/service/store";
import { dayStart, RETENTION_SECONDS } from "../src/shared/domain";
import { CURRENT } from "./fixtures";

let directory: string;
let store: Store;
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), "gym-store-"));
  store = new Store(join(directory, "history.sqlite3"));
});
afterEach(() => {
  store.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("内部人数记录", () => {
  test("连续60次相同人数只存1段，仍可还原完整已确认时长", () => {
    for (let minute = 0; minute < 60; minute++)
      store.add({ timestamp: CURRENT - 3600 + minute * 60, count: 81 }, "{}");
    expect(store.segments(CURRENT - 3600, CURRENT)).toHaveLength(1);
    expect(store.history(CURRENT)).toHaveLength(60);
    expect(store.status(CURRENT).count).toBe(81);
  });

  test("断网后相同人数也分段，不填补缺失分钟", () => {
    store.add({ timestamp: CURRENT - 180, count: 81 }, "{}");
    store.add({ timestamp: CURRENT - 120, count: 81 }, "{}");
    store.failure(CURRENT - 60, "断网");
    expect(store.status(CURRENT).error).toBe("断网");
    store.add({ timestamp: CURRENT, count: 81 }, "{}");
    expect(store.history(CURRENT).map((sample) => sample.timestamp)).toEqual([
      CURRENT - 180,
      CURRENT - 120,
      CURRENT,
    ]);
    expect(store.status(CURRENT).error).toBeNull();
  });

  test("30天边界截断长段并清理失败记录", () => {
    const cutoff = CURRENT - RETENTION_SECONDS;
    for (const offset of [-120, -60, 0, 60, 120])
      store.add({ timestamp: cutoff + offset, count: 30 }, "{}");
    store.failure(cutoff - 1, "旧错误");
    store.prune(CURRENT);
    expect(store.history(CURRENT).map((sample) => sample.timestamp)).toEqual([
      cutoff,
      cutoff + 60,
      cutoff + 120,
    ]);
    expect(store.db.prepare("SELECT * FROM attempts").all()).toHaveLength(0);
  });

  test("北京时间跨日正确分割持续人数段", () => {
    const midnight = dayStart("2026-11-11");
    store.add({ timestamp: midnight - 60, count: 10 }, "{}");
    store.add({ timestamp: midnight, count: 10 }, "{}");
    expect(store.day("2026-11-11", CURRENT)).toEqual([{ timestamp: midnight, count: 10 }]);
    expect(store.day("2026-11-10", CURRENT).every((sample) => sample.timestamp < midnight)).toBe(
      true,
    );
  });

  test("重新打开内部数据库后记录保留", () => {
    store.add({ timestamp: CURRENT, count: 0 }, '{"data":0,"status":0}');
    store.close();
    store = new Store(join(directory, "history.sqlite3"));
    expect(store.history(CURRENT)).toEqual([{ timestamp: CURRENT, count: 0 }]);
  });

  test("同一秒先失败后成功，状态始终反映最后一次结果", () => {
    store.add({ timestamp: CURRENT, count: 81 }, "{}");
    store.failure(CURRENT, "断网");
    expect(store.status(CURRENT).error).toBe("断网");
    store.add({ timestamp: CURRENT, count: 92 }, "{}");
    expect(store.status(CURRENT).error).toBeNull();
    expect(store.status(CURRENT).count).toBe(92);
  });

  test("反向时间范围不产生越界的虚构观测", () => {
    store.db.prepare("INSERT INTO samples VALUES(?,?,?,?)").run(CURRENT - 120, CURRENT, 81, "{}");
    expect(store.segments(CURRENT - 30, CURRENT - 60)).toEqual([]);
  });
});
