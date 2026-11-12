import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { expand, RETENTION_SECONDS } from "../shared/domain";
import {
  HISTORY_CHUNK_SIZE,
  HISTORY_FILE_MAX_BYTES,
  parseHistoryFile,
} from "../shared/history-file";
import { revealHistoryFile, saveHistoryFile } from "./history-files";
import type { Store } from "./store";

type Upload = { chunks: string[]; bytes: number; touched: number };
export type HistoryTransferOptions = Readonly<{
  directory?: string;
  reveal?: (path: string) => Promise<void>;
}>;
const uploadIdSchema = z.object({ id: z.string().uuid() });
const chunkSchema = uploadIdSchema.extend({
  index: z.number().int().nonnegative(),
  text: z.string().min(1).max(HISTORY_CHUNK_SIZE),
});

async function readBody(request: IncomingMessage): Promise<unknown> {
  request.setEncoding("utf8");
  let body = "";
  for await (const chunk of request) {
    body += z.string().parse(chunk);
    if (Buffer.byteLength(body) > 64_000) throw new Error("单次传输过大，请重新选择记录文件");
  }
  return JSON.parse(body);
}

export class HistoryTransfer {
  private readonly uploads = new Map<string, Upload>();
  private lastExport: string | null = null;

  constructor(
    private readonly store: Store,
    private readonly changed: () => void,
    private readonly clock: () => number,
    private readonly options: HistoryTransferOptions = {},
  ) {}

  async handle(request: IncomingMessage, response: ServerResponse, path: string): Promise<void> {
    if (request.method !== "POST") {
      response.writeHead(405).end();
      return;
    }
    for (const [id, upload] of this.uploads)
      if (this.clock() - upload.touched > 300) this.uploads.delete(id);
    try {
      const result = await this.perform(request, path);
      response.end(JSON.stringify(result));
    } catch (error) {
      console.error("处理历史记录失败", error);
      const message =
        error instanceof z.ZodError
          ? "记录传输格式不正确"
          : error instanceof Error
            ? error.message
            : "无法处理历史记录";
      response.writeHead(400).end(JSON.stringify({ error: message }));
    }
  }

  private async perform(request: IncomingMessage, path: string): Promise<unknown> {
    const current = this.clock();
    if (path === "/history/export") {
      const segments = this.store.segments(current - RETENTION_SECONDS, current);
      const records = new Set(expand(segments).map((sample) => Math.floor(sample.timestamp / 60)))
        .size;
      if (!records) throw new Error("暂无可导出的记录");
      const saved = await saveHistoryFile(
        {
          format: "zhongnan-gym-history",
          version: 1,
          venue: 8840,
          exportedAt: current,
          segments: segments.map((segment) => [segment.start, segment.end, segment.count]),
        },
        this.options.directory,
      );
      this.lastExport = saved.path;
      return { ...saved, records };
    }
    if (path === "/history/reveal") {
      if (!this.lastExport) throw new Error("请先导出记录");
      await (this.options.reveal ?? revealHistoryFile)(this.lastExport);
      return { ok: true };
    }
    if (path === "/history/import/start") {
      if (this.uploads.size >= 2) throw new Error("已有记录正在传输，请稍后重试");
      const id = randomUUID();
      this.uploads.set(id, { chunks: [], bytes: 0, touched: current });
      return { id };
    }
    if (
      !["/history/import/chunk", "/history/import/commit", "/history/import/cancel"].includes(path)
    )
      throw new Error("记录操作不存在");
    const body = await readBody(request);
    const { id } = uploadIdSchema.parse(body);
    const upload = this.uploads.get(id);
    if (!upload) throw new Error("记录传输已过期，请重新选择文件");
    if (path === "/history/import/cancel") {
      this.uploads.delete(id);
      return { ok: true };
    }
    if (path === "/history/import/chunk") {
      const chunk = chunkSchema.parse(body);
      if (chunk.index !== upload.chunks.length) throw new Error("记录分块顺序不正确，请重新导入");
      upload.bytes += Buffer.byteLength(chunk.text);
      if (upload.bytes > HISTORY_FILE_MAX_BYTES) {
        this.uploads.delete(id);
        throw new Error("记录文件过大");
      }
      upload.chunks.push(chunk.text);
      upload.touched = current;
      return { ok: true };
    }
    this.uploads.delete(id);
    const file = parseHistoryFile(upload.chunks.join(""));
    const result = this.store.importHistory(
      file.segments.map(([start, end, count]) => ({ start, end, count })),
      this.clock(),
    );
    if (result.added) this.changed();
    return result;
  }
}
