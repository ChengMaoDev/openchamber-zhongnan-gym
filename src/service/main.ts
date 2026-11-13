import { dirname, join } from "node:path";
import { nowSeconds } from "../shared/domain";
import { AutoUpdater } from "./auto-update";
import { Collector } from "./collector";
import { importLegacy } from "./legacy";
import { Predictor } from "./predictor";
import { createService } from "./server";
import { Store } from "./store";

const port = Number(process.env.OPENCHAMBER_SERVICE_PORT);
const token = process.env.OPENCHAMBER_SERVICE_TOKEN;
const directory = process.env.OPENCHAMBER_SERVICE_DATA_DIR;
if (!Number.isInteger(port) || port < 1 || port > 65535 || !token || !directory) {
  throw new Error("OpenChamber未提供有效的扩展服务环境");
}
const store = new Store(join(directory, "history.sqlite3"));
store.prune(nowSeconds());
let imported = 0;
let historyImportError: string | null = null;
try {
  imported = importLegacy(store, nowSeconds());
} catch (error) {
  historyImportError = "旧记录暂未导入，当前采集不受影响";
  console.error("导入旧记录失败", error);
}
const predictor = new Predictor(store);
const collector = new Collector(store, () => predictor.refresh());
const server = createService(token, store, predictor, imported, historyImportError);
const entry = process.argv[1];
const updater = entry ? new AutoUpdater(dirname(dirname(entry)), stop) : null;
server.on("error", (error) => {
  console.error("终南健身服务启动失败", error);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  collector.start();
  predictor.refresh();
  updater?.start();
});

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  updater?.stop();
  collector.stop();
  await predictor.stop();
  store.close();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
