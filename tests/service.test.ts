import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createService } from "../src/service/server";
import { Store } from "../src/service/store";
import { dayOf, dayStart, nowSeconds, type Prediction } from "../src/shared/domain";
import { viewSchema } from "../src/shared/schema";
import { cleanupDirectory } from "./cleanup";

test("扩展服务只接受宿主鉴权请求，不提供MCP或任意网络代理", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gym-api-"));
  const store = new Store(join(directory, "history.sqlite3"));
  store.add({ timestamp: nowSeconds(), count: 81 }, "{}");
  const server = createService("test-only", store, { prediction: null, error: null }, 0);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试端口不可用");
  const base = `http://127.0.0.1:${address.port}`;
  const headers = { Authorization: "Bearer test-only" };
  try {
    expect((await fetch(`${base}/health`)).status).toBe(401);
    expect((await fetch(`${base}/health`, { headers })).status).toBe(200);
    const response = await fetch(`${base}/view?day=${dayOf(nowSeconds())}`, { headers });
    const raw: unknown = await response.json();
    const data = viewSchema.parse(raw);
    expect(data.status.count).toBe(81);
    expect(data.samples).toHaveLength(1);
    expect((await fetch(`${base}/mcp`, { headers })).status).toBe(404);
    expect((await fetch(`${base}/view?day=2026-02-31`, { headers })).status).toBe(400);
    expect((await fetch(`${base}/view`, { method: "POST", headers })).status).toBe(405);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    cleanupDirectory(directory);
  }
});

test("跨日、过期、已失败的预测不伪装成今日预测", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gym-forecast-api-"));
  const store = new Store(join(directory, "history.sqlite3"));
  const current = dayStart("2026-11-12") + 10;
  const state: { prediction: Prediction; error: string | null; isComputing: boolean } = {
    prediction: {
      issuedAt: current - 20,
      points: [],
      method: "test",
      trainingDays: 1,
      mae: null,
      weekdayDays: [1, 0, 0, 0, 0, 0, 0],
    },
    error: null,
    isComputing: true,
  };
  const server = createService("test-only", store, state, 0, null, () => current);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试端口不可用");
  const view = async () => {
    const response = await fetch(`http://127.0.0.1:${address.port}/view`, {
      headers: { Authorization: "Bearer test-only" },
    });
    const raw: unknown = await response.json();
    return viewSchema.parse(raw);
  };
  try {
    expect((await view()).prediction).toBeNull();
    state.prediction = {
      ...state.prediction,
      issuedAt: current,
      points: [
        { timestamp: current - 1, count: 30, lower: null, upper: null },
        { timestamp: current + 300, count: 40, lower: null, upper: null },
      ],
    };
    expect((await view()).prediction?.points.map((point) => point.timestamp)).toEqual([
      current + 300,
    ]);
    expect((await view()).modelPending).toBe(true);
    state.error = "内核错误";
    expect((await view()).prediction).toBeNull();
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    cleanupDirectory(directory);
  }
});
