import { API_URL, nowSeconds, POLL_MS } from "../shared/domain";
import type { Store } from "./store";

export type Request = (url: string, init: RequestInit) => Promise<Response>;

export function parseCount(value: unknown): number {
  if (
    !value ||
    typeof value !== "object" ||
    !("status" in value) ||
    !("data" in value) ||
    value.status !== 0 ||
    typeof value.data !== "number" ||
    !Number.isSafeInteger(value.data) ||
    value.data < 0
  ) {
    throw new Error("接口人数格式异常");
  }
  return value.data;
}

export class Collector {
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private stopped = false;
  private lastStarted = -Infinity;
  private controller: AbortController | null = null;

  constructor(
    private readonly store: Store,
    private readonly changed: () => void,
    private readonly request: Request = fetch,
    private readonly monotonic = () => performance.now(),
  ) {}

  start(): void {
    const previous = this.store.status(nowSeconds()).updatedAt;
    if (previous !== null)
      this.lastStarted = this.monotonic() - Math.max(0, nowSeconds() - previous) * 1000;
    this.timer = setInterval(() => void this.tick(), 1000);
    void this.tick();
  }

  async tick(): Promise<void> {
    if (this.stopped || this.active || this.monotonic() - this.lastStarted < POLL_MS) return;
    this.lastStarted = this.monotonic();
    this.active = true;
    this.controller = new AbortController();
    const timeout = setTimeout(() => this.controller?.abort(), 15000);
    try {
      this.store.prune(nowSeconds());
      const response = await this.request(API_URL, {
        signal: this.controller.signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error(`人数请求返回 HTTP ${response.status}`);
      const payload = await response.text();
      if (payload.length > 16384) throw new Error("人数响应过大");
      const value: unknown = JSON.parse(payload);
      this.store.add({ timestamp: nowSeconds(), count: parseCount(value) }, payload);
    } catch (error) {
      if (!this.stopped) {
        const message = error instanceof Error ? error.message : "采集失败";
        try {
          this.store.failure(nowSeconds(), message);
        } catch (storageError) {
          console.error("记录采集失败状态时发生错误", storageError);
        }
      }
    } finally {
      clearTimeout(timeout);
      this.active = false;
      this.controller = null;
      if (!this.stopped) this.changed();
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.controller?.abort();
  }
}
