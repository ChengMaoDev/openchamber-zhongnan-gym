import { z } from "zod";

export const HISTORY_FILE_MAX_BYTES = 8_000_000;
export const HISTORY_CHUNK_SIZE = 24_000;
const timestamp = z.number().int().nonnegative();
const segment = z.tuple([timestamp, timestamp, z.number().int().nonnegative()]);

export const historyFileSchema = z
  .object({
    format: z.literal("zhongnan-gym-history"),
    version: z.literal(1),
    venue: z.literal(8840),
    exportedAt: timestamp,
    segments: z.array(segment).max(100_000),
  })
  .strict()
  .superRefine((file, context) => {
    let previous = -1;
    for (const [start, end] of file.segments) {
      if (end < start || start <= previous) {
        context.addIssue({ code: "custom", message: "记录时间需要按顺序排列且不能重叠" });
        return;
      }
      previous = end;
    }
  });
export type HistoryFile = z.infer<typeof historyFileSchema>;
export const importResultSchema = z.object({
  added: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
});
export const exportResultSchema = z.object({
  fileName: z.string(),
  path: z.string(),
  records: z.number().int().nonnegative(),
});

export function parseHistoryFile(text: string): HistoryFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("记录文件不是有效的 JSON");
  }
  const result = historyFileSchema.safeParse(value);
  if (!result.success) throw new Error("记录文件格式不正确，请选择终南健身导出的文件");
  return result.data;
}
