import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createService } from "../src/service/server";
import { Store } from "../src/service/store";
import { RETENTION_SECONDS } from "../src/shared/domain";
import {
  exportResultSchema,
  HISTORY_CHUNK_SIZE,
  importResultSchema,
  parseHistoryFile,
} from "../src/shared/history-file";
import { cleanupDirectory } from "./cleanup";
import { CURRENT } from "./fixtures";

async function scenario(
  run: (context: {
    store: Store;
    post: (path: string, body?: unknown, authorized?: boolean) => Promise<Response>;
    changed: () => number;
    revealed: () => string | null;
    advance: () => void;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "gym-transfer-"));
  const store = new Store(join(directory, "history.sqlite3"));
  let changed = 0;
  let revealed: string | null = null;
  let current = CURRENT;
  const server = createService(
    "test-only",
    store,
    {
      prediction: null,
      error: null,
      refresh: () => {
        changed++;
      },
    },
    0,
    null,
    () => current,
    {
      directory: join(directory, "Downloads"),
      reveal: async (path) => {
        revealed = path;
      },
    },
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("测试端口不可用");
  try {
    await run({
      store,
      changed: () => changed,
      revealed: () => revealed,
      advance: () => {
        current += 301;
      },
      post: (path, body, authorized = true) =>
        fetch(`http://127.0.0.1:${address.port}${path}`, {
          method: "POST",
          headers: authorized ? { Authorization: "Bearer test-only" } : {},
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
    });
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    store.close();
    cleanupDirectory(directory);
  }
}

const uploadId = z.object({ id: z.string().uuid() });

test("导出文件不含内部状态，通过分块导入大于宿主单次限制的完整30天数据", async () => {
  await scenario(async ({ store, post, changed, revealed }) => {
    expect((await post("/history/export", undefined, false)).status).toBe(401);
    expect((await post("/history/export")).status).toBe(400);
    store.db.exec("BEGIN IMMEDIATE");
    try {
      const insert = store.db.prepare("INSERT INTO samples VALUES(?,?,?,?)");
      for (let stamp = CURRENT - RETENTION_SECONDS; stamp <= CURRENT; stamp += 60)
        insert.run(stamp, stamp, (stamp / 60) % 200, '{"internal":"not-exported"}');
      store.db.exec("COMMIT");
    } catch (error) {
      store.db.exec("ROLLBACK");
      throw error;
    }
    const local = store.status(CURRENT);
    const saved = exportResultSchema.parse(await (await post("/history/export")).json());
    const text = readFileSync(saved.path, "utf8");
    expect(saved.records).toBe(43201);
    expect(text.length).toBeGreaterThan(64000);
    expect(text.includes("internal")).toBe(false);
    expect(parseHistoryFile(text).segments).toHaveLength(43201);
    await post("/history/reveal");
    expect(revealed()).toBe(saved.path);
    store.db.exec("DELETE FROM samples");
    const { id } = uploadId.parse(await (await post("/history/import/start")).json());
    for (let offset = 0, index = 0; offset < text.length; offset += HISTORY_CHUNK_SIZE, index++) {
      const body = { id, index, text: text.slice(offset, offset + HISTORY_CHUNK_SIZE) };
      expect(JSON.stringify(body).length).toBeLessThan(64000);
      expect((await post("/history/import/chunk", body)).status).toBe(200);
    }
    expect(store.history(CURRENT)).toHaveLength(0);
    const result = importResultSchema.parse(
      await (await post("/history/import/commit", { id })).json(),
    );
    expect(result.added).toBe(43201);
    expect(store.history(CURRENT)).toHaveLength(43201);
    expect(store.status(CURRENT).count).toBeNull();
    expect(local.count).not.toBeNull();
    expect(changed()).toBe(1);
  });
});

test("格式错误、中断、乱序和过期传输不会改变现有历史", async () => {
  await scenario(async ({ store, post, advance, changed }) => {
    store.add({ timestamp: CURRENT, count: 81 }, "{}");
    const before = store.history(CURRENT);
    let { id } = uploadId.parse(await (await post("/history/import/start")).json());
    expect((await post("/history/import/chunk", { id, index: 1, text: "bad" })).status).toBe(400);
    expect((await post("/history/import/chunk", { id, index: 0, text: "bad" })).status).toBe(200);
    expect((await post("/history/import/commit", { id })).status).toBe(400);
    ({ id } = uploadId.parse(await (await post("/history/import/start")).json()));
    await post("/history/import/chunk", { id, index: 0, text: '{"format":' });
    await post("/history/import/cancel", { id });
    expect((await post("/history/import/commit", { id })).status).toBe(400);
    ({ id } = uploadId.parse(await (await post("/history/import/start")).json()));
    advance();
    expect((await post("/history/import/commit", { id })).status).toBe(400);
    expect(store.history(CURRENT)).toEqual(before);
    expect(changed()).toBe(0);
  });
});

test("错误场馆、倒序、重叠、非整数人数不能作为记录文件导入", () => {
  const file = {
    format: "zhongnan-gym-history",
    version: 1,
    venue: 8840,
    exportedAt: CURRENT,
    segments: [[CURRENT - 60, CURRENT, 81]],
  };
  expect(parseHistoryFile(JSON.stringify(file)).segments).toHaveLength(1);
  for (const invalid of [
    { ...file, venue: 1 },
    { ...file, version: 2 },
    { ...file, segments: [[CURRENT, CURRENT - 60, 1]] },
    {
      ...file,
      segments: [
        [CURRENT, CURRENT, 1],
        [CURRENT, CURRENT, 2],
      ],
    },
    { ...file, segments: [[CURRENT, CURRENT, 1.5]] },
    { ...file, segments: [[CURRENT, CURRENT, -1]] },
  ])
    expect(() => parseHistoryFile(JSON.stringify(invalid))).toThrow();
});
