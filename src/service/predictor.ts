import { dirname, join } from "node:path";
import { Worker } from "node:worker_threads";
import { z } from "zod";
import { nowSeconds, type Prediction } from "../shared/domain";
import { predictionSchema } from "../shared/schema";
import type { Store } from "./store";

const reply = z.union([
  z.object({ prediction: predictionSchema }),
  z.object({ error: z.string() }),
]);

function workerPath(): string {
  const entry = process.argv[1];
  if (!entry) throw new Error("扩展后台入口缺失");
  return join(dirname(entry), "model-worker.cjs");
}

export class Predictor {
  prediction: Prediction | null = null;
  error: string | null = null;
  private active = false;
  private readonly worker: Worker;

  constructor(
    private readonly store: Store,
    path = workerPath(),
  ) {
    this.worker = new Worker(path);
    this.worker.on("message", (value: unknown) => {
      this.active = false;
      const result = reply.safeParse(value);
      if (!result.success) {
        this.error = "预测结果格式异常";
        return;
      }
      if ("error" in result.data) {
        this.error = result.data.error;
        return;
      }
      this.prediction = result.data.prediction;
      this.error = null;
    });
    this.worker.on("error", (error) => {
      this.active = false;
      this.error = error instanceof Error ? error.message : "预测内核异常";
      console.error("预测内核错误", error);
    });
    this.worker.on("exit", (code) => {
      if (code !== 0) this.error = "预测内核已停止";
    });
  }

  refresh(): void {
    if (this.active) return;
    this.active = true;
    const current = nowSeconds();
    this.worker.postMessage({ samples: this.store.history(current), current });
  }

  async stop(): Promise<void> {
    await this.worker.terminate();
  }
}
