import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { Predictor } from "../src/service/predictor";
import { createService } from "../src/service/server";
import { Store } from "../src/service/store";
import { dayOf, dayStart, nowSeconds } from "../src/shared/domain";
import type { HistoryFile } from "../src/shared/history-file";
import { cleanupDirectory } from "../tests/cleanup";

const root = resolve(import.meta.dir, "..");
const directory = mkdtempSync(join(tmpdir(), "gym-transfer-browser-"));
const store = new Store(join(directory, "history.sqlite3"));
const current = nowSeconds();
store.add({ timestamp: current, count: 81 }, "{}");
const predictor = new Predictor(store, join(root, "service/model-worker.cjs"));
let revealed: string | null = null;
const credential = randomUUID();
const service = createService(credential, store, predictor, 0, null, nowSeconds, {
  directory: join(directory, "Downloads"),
  reveal: async (path) => {
    revealed = path;
  },
});
await new Promise<void>((resolve) => service.listen(0, "127.0.0.1", resolve));
const address = service.address();
if (!address || typeof address === "string") throw new Error("测试服务端口缺失");
predictor.refresh();
const timer = setInterval(() => predictor.refresh(), 60000);
const segments: HistoryFile["segments"] = [];
for (let offset = 3; offset > 0; offset--) {
  for (let minute = 420; minute < 1380; minute++) {
    const timestamp = dayStart(dayOf(current)) - offset * 86400 + minute * 60;
    segments.push([timestamp, timestamp, 30 + Math.round(20 * Math.sin(minute / 60))]);
  }
}
const file: HistoryFile = {
  format: "zhongnan-gym-history",
  version: 1,
  venue: 8840,
  exportedAt: current,
  segments,
};
await Bun.write(join(directory, "shared-history.json"), JSON.stringify(file));
await Bun.write(join(directory, "invalid.json"), '{"unrelated":true}');
const requestSchema = z.object({
  method: z.enum(["GET", "POST"]),
  path: z.string().regex(/^\/(?:view|history\/[a-z/]+)$/),
  body: z.string().optional(),
  query: z.record(z.string(), z.string()).optional(),
});
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 58744,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    if (url.pathname === "/test-events") return Response.json({ revealed });
    if (url.pathname === "/test-service" && request.method === "POST") {
      const input = requestSchema.parse(await request.json());
      const target = new URL(input.path, `http://127.0.0.1:${address.port}`);
      for (const [key, value] of Object.entries(input.query ?? {}))
        target.searchParams.set(key, value);
      const response = await fetch(target, {
        method: input.method,
        headers: { Authorization: `Bearer ${credential}` },
        ...(input.body ? { body: input.body } : {}),
      });
      return new Response(await response.text(), {
        status: response.status,
        headers: { "Content-Type": "application/json" },
      });
    }
    const path = url.pathname === "/harness" ? "tests/harness.html" : url.pathname.slice(1);
    if (
      !["tests/harness.html", "panel/index.html", "panel/main.js", "panel/style.css"].includes(path)
    )
      return new Response("Not found", { status: 404 });
    return new Response(Bun.file(resolve(root, path)));
  },
});
console.log(
  JSON.stringify({ url: `http://${server.hostname}:${server.port}/harness?live=1`, directory }),
);
process.once(
  "SIGTERM",
  () =>
    void (async () => {
      server.stop(true);
      clearInterval(timer);
      await predictor.stop();
      await new Promise<void>((resolve) => service.close(() => resolve()));
      store.close();
      cleanupDirectory(directory);
      process.exit(0);
    })(),
);
