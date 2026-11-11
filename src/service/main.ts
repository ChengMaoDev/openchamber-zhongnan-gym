import { join } from "node:path";
import { nowSeconds } from "../shared/domain";
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
const imported = importLegacy(store, nowSeconds());
const predictor = new Predictor(store);
const collector = new Collector(store, () => predictor.refresh());
const server = createService(token, store, predictor, imported);
server.on("error", (error) => {
  console.error("终南健身服务启动失败", error);
  process.exitCode = 1;
});
server.listen(port, "127.0.0.1", () => {
  collector.start();
  predictor.refresh();
});

let stopping = false;
async function stop(): Promise<void> {
  if (stopping) return;
  stopping = true;
  collector.stop();
  await predictor.stop();
  store.close();
  server.close(() => process.exit(0));
}
process.on("SIGTERM", () => void stop());
process.on("SIGINT", () => void stop());
