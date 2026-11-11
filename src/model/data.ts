import { dayOf, type Sample } from "../shared/domain";

export function bins(samples: readonly Sample[]): Sample[] {
  const groups = new Map<number, { timestamp: number; sum: number; count: number }>();
  for (const sample of samples) {
    const key = Math.floor(sample.timestamp / 300);
    const group = groups.get(key) ?? { timestamp: 0, sum: 0, count: 0 };
    groups.set(key, {
      timestamp: Math.max(group.timestamp, sample.timestamp),
      sum: group.sum + sample.count,
      count: group.count + 1,
    });
  }
  return [...groups.values()]
    .sort((a, b) => a.timestamp - b.timestamp)
    .map((group) => ({ timestamp: group.timestamp, count: Math.round(group.sum / group.count) }));
}

export function usableDays(samples: readonly Sample[]): string[] {
  const groups = new Map<string, number[]>();
  for (const sample of samples) {
    const day = dayOf(sample.timestamp);
    const group = groups.get(day) ?? [];
    group.push(sample.timestamp);
    groups.set(day, group);
  }
  return [...groups.entries()]
    .filter(
      ([, stamps]) => stamps.length >= 48 && Math.max(...stamps) - Math.min(...stamps) >= 21600,
    )
    .map(([day]) => day)
    .sort();
}

export function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

export function quantile(values: readonly number[], fraction: number): number {
  if (!values.length) throw new Error("无法计算空数据的分位数");
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * fraction;
  const lower = sorted[Math.floor(position)];
  const upper = sorted[Math.ceil(position)];
  if (lower === undefined || upper === undefined) throw new Error("分位位置无效");
  return lower + (upper - lower) * (position % 1);
}
