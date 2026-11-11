import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Store } from "../src/service/store";
import { nowSeconds } from "../src/shared/domain";
import { viewSchema } from "../src/shared/schema";
import { history } from "../tests/fixtures";

const directory = mkdtempSync(join(tmpdir(), "gym-host-"));
const store = new Store(join(directory, "history.sqlite3"));
for (const sample of history(1, nowSeconds())) store.add(sample, "{}");
store.add({ timestamp: nowSeconds(), count: 81 }, "{}");
store.db.prepare("INSERT INTO settings VALUES('legacy-imported','0')").run();
store.close();
const listener = createServer();
await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
const address = listener.address();
if (!address || typeof address === "string") throw new Error("测试端口不可用");
const port = address.port;
await new Promise<void>((resolve) => listener.close(() => resolve()));
const credential = randomUUID();
const root = resolve(import.meta.dir, "..");
const runtime = process.env.GYM_RUNTIME ?? "node";
const child = spawn(runtime, [join(root, "service", "main.cjs")], {
  env: {
    ...process.env,
    OPENCHAMBER_SERVICE_PORT: String(port),
    OPENCHAMBER_SERVICE_TOKEN: credential,
    OPENCHAMBER_SERVICE_DATA_DIR: directory,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
let logs = "";
child.stderr.on("data", (chunk: Buffer) => {
  logs = (logs + chunk.toString()).slice(-8000);
});
const base = `http://127.0.0.1:${port}`;
const headers = { Authorization: `Bearer ${credential}` };
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    try {
      const response = await fetch(`${base}/health`, {
        headers,
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch (error) {
      if (child.exitCode !== null) throw new Error(`扩展后台提前退出：${logs}`, { cause: error });
    }
    await Bun.sleep(100);
  }
  if (!ready) throw new Error(`扩展服务未就绪：${logs}`);
  if ((await fetch(`${base}/health`)).status !== 401) throw new Error("服务缺少鉴权");
  let trained = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const response = await fetch(`${base}/view`, { headers });
    const raw: unknown = await response.json();
    const view = viewSchema.parse(raw);
    if (view.status.count !== 81) throw new Error("内部数据库读取异常");
    if (view.prediction?.trainingDays === 1) {
      trained = true;
      break;
    }
    await Bun.sleep(100);
  }
  if (!trained) throw new Error(`独立预测线程未完成训练：${logs}`);
  if ((await fetch(`${base}/mcp`, { headers })).status !== 404) throw new Error("扩展不应提供MCP");
  console.log("打包后台：内部SQLite、宿主鉴权、预测工作线程正常；没有MCP接口");
} finally {
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
  rmSync(directory, { recursive: true, force: true });
}
