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
  private worker: Worker | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly store: Store,
    private readonly path = workerPath(),
    private readonly timeoutMs = 30000,
  ) {}

  get isComputing(): boolean {
    return this.active;
  }

  private createWorker(): Worker {
    const worker = new Worker(this.path);
    this.worker = worker;
    worker.on("message", (value: unknown) => {
      if (this.worker !== worker || this.stopped) return;
      this.finish();
      const result = reply.safeParse(value);
      if (!result.success) {
        this.fail("预测结果格式异常", worker);
        return;
      }
      if ("error" in result.data) {
        this.prediction = null;
        this.error = result.data.error;
        return;
      }
      this.prediction = result.data.prediction;
      this.error = null;
    });
    worker.on("error", (error) => {
      if (this.worker !== worker || this.stopped) return;
      this.fail(error instanceof Error ? error.message : "预测内核异常", worker);
      console.error("预测内核错误", error);
    });
    worker.on("exit", () => {
      if (this.worker === worker && !this.stopped)
        this.fail("预测内核已停止，下次采集后恢复", worker);
    });
    return worker;
  }

  private finish(): void {
    this.active = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private fail(message: string, worker: Worker): void {
    this.finish();
    this.error = message;
    this.prediction = null;
    this.worker = null;
    void worker.terminate().catch((error: unknown) => console.error("停止预测线程失败", error));
  }

  refresh(): void {
    if (this.active || this.stopped) return;
    try {
      const current = nowSeconds();
      const samples = this.store.history(current);
      const worker = this.worker ?? this.createWorker();
      this.active = true;
      this.timer = setTimeout(
        () => this.fail("预测计算超时，下次采集后重试", worker),
        this.timeoutMs,
      );
      worker.postMessage({ samples, current });
    } catch (error) {
      this.finish();
      this.error = error instanceof Error ? error.message : "无法启动预测";
      this.prediction = null;
      console.error("启动预测失败", error);
    }
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.finish();
    const worker = this.worker;
    this.worker = null;
    if (worker) await worker.terminate();
  }
}
