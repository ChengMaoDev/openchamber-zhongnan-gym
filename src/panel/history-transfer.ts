import type { HostClient } from "@openchamber/sdk";
import { mountButton } from "@openchamber/sdk/ui";
import { z } from "zod";
import {
  exportResultSchema,
  HISTORY_CHUNK_SIZE,
  HISTORY_FILE_MAX_BYTES,
  importResultSchema,
  parseHistoryFile,
} from "../shared/history-file";

export function mountHistoryTransfer(
  root: HTMLElement,
  host: Pick<HostClient, "serviceRequest">,
  changed: () => Promise<void>,
) {
  const notice = root.querySelector("[role=status]");
  const input = root.querySelector("input");
  if (!(notice instanceof HTMLElement) || !(input instanceof HTMLInputElement))
    throw new Error("记录导入导出控件缺失");
  let busy = false;
  let disposed = false;
  const signal = new AbortController();
  const buttons: ReturnType<typeof mountButton>[] = [];
  const container = (id: string): HTMLElement => {
    const element = root.querySelector(`[data-action=${id}]`);
    if (!(element instanceof HTMLElement)) throw new Error(`记录按钮缺失：${id}`);
    return element;
  };
  const request = async (path: string, body?: { id: string; index?: number; text?: string }) => {
    const reply = await host.serviceRequest({
      method: "POST",
      path,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const value: unknown = JSON.parse(reply.body);
    if (reply.status !== 200) {
      const error = z.object({ error: z.string() }).safeParse(value);
      throw new Error(error.success ? error.data.error : "记录操作失败，请重试");
    }
    return value;
  };
  const run = async (work: () => Promise<void>) => {
    if (busy || disposed) return;
    busy = true;
    for (const button of buttons) button.update({ disabled: true });
    try {
      await work();
    } catch (error) {
      if (!disposed) notice.textContent = error instanceof Error ? error.message : "记录操作失败";
    } finally {
      busy = false;
      if (!disposed) for (const button of buttons) button.update({ disabled: false });
    }
  };
  const reveal = container("reveal");
  buttons.push(
    mountButton(container("export"), {
      label: "导出记录",
      variant: "ghost",
      size: "xs",
      onClick: () =>
        void run(async () => {
          notice.textContent = "正在导出…";
          const result = exportResultSchema.parse(await request("/history/export"));
          if (disposed) return;
          notice.textContent = `已导出 ${result.records} 条记录到下载文件夹`;
          notice.title = result.path;
          reveal.hidden = false;
        }),
    }),
  );
  buttons.push(
    mountButton(container("import"), {
      label: "导入记录",
      variant: "ghost",
      size: "xs",
      onClick: () => input.click(),
    }),
  );
  buttons.push(
    mountButton(reveal, {
      label: "打开文件夹",
      variant: "ghost",
      size: "xs",
      onClick: () =>
        void run(async () => {
          await request("/history/reveal");
        }),
    }),
  );
  input.addEventListener(
    "change",
    () => {
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      void run(async () => {
        notice.title = "";
        notice.textContent = "正在读取文件…";
        if (file.size > HISTORY_FILE_MAX_BYTES)
          throw new Error("记录文件过大，请选择插件导出的文件");
        const text = JSON.stringify(parseHistoryFile(await file.text()));
        const { id } = z
          .object({ id: z.string().uuid() })
          .parse(await request("/history/import/start"));
        try {
          for (
            let offset = 0, index = 0;
            offset < text.length;
            offset += HISTORY_CHUNK_SIZE, index++
          ) {
            if (disposed) throw new Error("面板已关闭");
            notice.textContent = `正在导入… ${Math.floor((offset / text.length) * 100)}%`;
            await request("/history/import/chunk", {
              id,
              index,
              text: text.slice(offset, offset + HISTORY_CHUNK_SIZE),
            });
          }
          const result = importResultSchema.parse(await request("/history/import/commit", { id }));
          if (disposed) return;
          notice.textContent = result.added
            ? `已新增 ${result.added} 条记录，正在更新预测…`
            : "没有需要补充的新记录";
          await changed();
          if (!disposed && result.added) notice.textContent = `已新增 ${result.added} 条记录`;
        } catch (error) {
          try {
            await request("/history/import/cancel", { id });
          } catch (cancelError) {
            console.error("结束记录传输失败", cancelError);
          }
          throw error;
        }
      });
    },
    { signal: signal.signal },
  );
  return {
    dispose() {
      disposed = true;
      signal.abort();
      for (const button of buttons) button.dispose();
    },
  };
}
