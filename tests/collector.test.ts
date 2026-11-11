import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Collector, parseCount, type Request } from "../src/service/collector";
import { Store } from "../src/service/store";
import { nowSeconds } from "../src/shared/domain";

test("服务失败、布尔、负数不能当作0人", () => {
  for (const value of [
    null,
    [],
    { status: true, data: 10 },
    { status: 1, data: 30 },
    { status: 0, data: false },
    { status: 0, data: -1 },
  ]) {
    expect(() => parseCount(value)).toThrow();
  }
  expect(parseCount({ status: 0, data: 0 })).toBe(0);
});

test("服务重启后也不会在一分钟内重复请求", () => {
  const directory = mkdtempSync(join(tmpdir(), "gym-request-cadence-"));
  const store = new Store(join(directory, "history.sqlite3"));
  store.markRequest(nowSeconds());
  let calls = 0;
  const request: Request = async () => {
    calls++;
    return new Response('{"status":0,"data":81}');
  };
  const collector = new Collector(
    store,
    () => {},
    request,
    () => 0,
  );
  try {
    collector.start();
    collector.start();
    expect(calls).toBe(0);
  } finally {
    collector.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("后台每分钟一次，关闭面板不影响采集节奏，失败后恢复", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gym-collector-"));
  const store = new Store(join(directory, "history.sqlite3"));
  let clock = 0;
  let calls = 0;
  const responses = [
    new Response('{"status":0,"data":81}'),
    new Response("{}", { status: 503 }),
    new Response('{"status":0,"data":92}'),
  ];
  const request: Request = async () => {
    calls++;
    const response = responses.shift();
    if (!response) throw new Error("请求次数过多");
    return response;
  };
  const collector = new Collector(
    store,
    () => {},
    request,
    () => clock,
  );
  try {
    await collector.tick();
    expect(store.status(nowSeconds()).count).toBe(81);
    await collector.tick();
    expect(calls).toBe(1);
    clock += 60000;
    await collector.tick();
    expect(store.status(nowSeconds()).count).toBe(81);
    clock += 60000;
    await collector.tick();
    expect(store.status(nowSeconds()).count).toBe(92);
    expect(calls).toBe(3);
  } finally {
    collector.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
