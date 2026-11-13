import { z } from "zod";

export const sampleSchema = z.object({ timestamp: z.number(), count: z.number().nonnegative() });
export const predictionSchema = z.object({
  issuedAt: z.number(),
  points: z.array(
    z.object({
      timestamp: z.number(),
      count: z.number().nonnegative(),
      lower: z.number().nullable(),
      upper: z.number().nullable(),
    }),
  ),
  method: z.string(),
  trainingDays: z.number().int().nonnegative(),
  mae: z.number().nullable(),
  weekdayDays: z.array(z.number().int().nonnegative()).length(7),
});
export const viewSchema = z.object({
  version: z.string().optional(),
  day: z.string(),
  today: z.string(),
  status: z.object({
    count: z.number().nullable(),
    updatedAt: z.number().nullable(),
    error: z.string().nullable(),
    stale: z.boolean(),
  }),
  samples: z.array(sampleSchema),
  prediction: predictionSchema.nullable(),
  modelError: z.string().nullable(),
  modelPending: z.boolean().default(false),
  historyImportError: z.string().nullable().default(null),
  imported: z.number().int().nonnegative(),
});
export type ViewData = z.infer<typeof viewSchema>;
