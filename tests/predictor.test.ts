import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Predictor } from "../src/service/predictor";
import { Store } from "../src/service/store";

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (condition()) return;
    await Bun.sleep(10);
  }
  throw new Error("预测线程状态没有按预期改变");
}

test("预测线程意外退出后，下次采集能够重建并继续预测", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gym-worker-"));
  const path = join(directory, "worker.cjs");
  const marker = JSON.stringify(join(directory, "first-run"));
  writeFileSync(
    path,
    `
    const fs=require('node:fs');
    const {parentPort}=require('node:worker_threads');
    parentPort.on('message', request=>{
      if(!fs.existsSync(${marker})){fs.writeFileSync(${marker},'1');process.exit(0);}
      parentPort.postMessage({prediction:{issuedAt:request.current,points:[],method:'test',trainingDays:0,mae:null,weekdayDays:[0,0,0,0,0,0,0]}});
    });
  `,
  );
  const store = new Store(join(directory, "history.sqlite3"));
  const predictor = new Predictor(store, path);
  try {
    predictor.refresh();
    await waitFor(() => predictor.error !== null);
    predictor.refresh();
    await waitFor(() => predictor.prediction !== null);
    expect(predictor.error).toBeNull();
  } finally {
    await predictor.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("预测线程不响应时有超时保护，而不是永久卡在计算中", async () => {
  const directory = mkdtempSync(join(tmpdir(), "gym-worker-timeout-"));
  const path = join(directory, "worker.cjs");
  writeFileSync(path, "require('node:worker_threads').parentPort.on('message',()=>{});");
  const store = new Store(join(directory, "history.sqlite3"));
  const predictor = new Predictor(store, path, 100);
  try {
    predictor.refresh();
    await waitFor(() => predictor.error !== null);
    expect(predictor.error).toContain("超时");
    expect(predictor.isComputing).toBe(false);
  } finally {
    await predictor.stop();
    store.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
