export const RETENTION_SECONDS = 30 * 86400;
export const POLL_MS = 60000;
export const ZONE = "Asia/Shanghai";
export const API_URL = "https://www.forzadata.cn/api/fitnessCenter/8840/actualNumber";

export type Sample = Readonly<{ timestamp: number; count: number }>;
export type Segment = Readonly<{ start: number; end: number; count: number }>;
export type Estimate = Readonly<{
  timestamp: number;
  count: number;
  lower: number | null;
  upper: number | null;
}>;
export type Prediction = Readonly<{
  issuedAt: number;
  points: readonly Estimate[];
  method: string;
  trainingDays: number;
  mae: number | null;
  weekdayDays: readonly number[];
}>;
export type Status = Readonly<{
  count: number | null;
  updatedAt: number | null;
  error: string | null;
  stale: boolean;
}>;

export function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

export function dayOf(timestamp: number): string {
  return new Date((timestamp + 28800) * 1000).toISOString().slice(0, 10);
}

export function dayStart(day: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("日期格式应为 YYYY-MM-DD");
  const stamp = Date.parse(`${day}T00:00:00+08:00`) / 1000;
  if (!Number.isFinite(stamp) || dayOf(stamp) !== day) throw new Error("日期无效");
  return stamp;
}

export function minuteOf(timestamp: number): number {
  return Math.floor(((((timestamp + 28800) % 86400) + 86400) % 86400) / 60);
}

export function weekday(timestamp: number): number {
  return (new Date((timestamp + 28800) * 1000).getUTCDay() + 6) % 7;
}

export function expand(segments: readonly Segment[]): Sample[] {
  const samples: Sample[] = [];
  for (const segment of segments) {
    for (let stamp = segment.start; stamp <= segment.end; stamp += 60) {
      samples.push({ timestamp: stamp, count: segment.count });
    }
    if (samples.at(-1)?.timestamp !== segment.end) {
      samples.push({ timestamp: segment.end, count: segment.count });
    }
  }
  return samples;
}
