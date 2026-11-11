import { dayOf, type Estimate, type Sample } from "../shared/domain";
import type { ViewData } from "../shared/schema";

export type Reading = Readonly<{
  timestamp: number;
  count: number;
  kind: "actual" | "forecast";
  lower: number | null;
  upper: number | null;
}>;

export function visibleForecast(data: ViewData, current: number): Estimate[] {
  if (data.day !== data.today || data.modelError) return [];
  return (data.prediction?.points ?? []).filter(
    (point) => point.timestamp > current && dayOf(point.timestamp) === data.today,
  );
}

export function forecastTraces(data: ViewData, current: number): Estimate[][] {
  const groups: Estimate[][] = [];
  let group: Estimate[] = [];
  for (const point of visibleForecast(data, current)) {
    const previous = group.at(-1);
    if (previous && point.timestamp - previous.timestamp > 300) {
      groups.push(group);
      group = [];
    }
    group.push(point);
  }
  if (group.length) groups.push(group);
  const firstGroup = groups[0];
  const first = firstGroup?.[0];
  const latest = data.samples.at(-1);
  if (
    firstGroup &&
    first &&
    latest &&
    !data.status.stale &&
    latest.timestamp <= current &&
    current - latest.timestamp <= 180 &&
    first.timestamp > latest.timestamp &&
    first.timestamp - latest.timestamp <= 360
  ) {
    firstGroup.unshift({
      timestamp: latest.timestamp,
      count: latest.count,
      lower: latest.count,
      upper: latest.count,
    });
  }
  return groups;
}

export function chartReadings(
  samples: readonly Sample[],
  forecast: readonly Estimate[],
): Reading[] {
  return [
    ...samples.map<Reading>((point) => ({ ...point, kind: "actual", lower: null, upper: null })),
    ...forecast.map<Reading>((point) => ({ ...point, kind: "forecast" })),
  ].sort((a, b) => a.timestamp - b.timestamp);
}

export function nearestReading(readings: readonly Reading[], timestamp: number): Reading | null {
  let left = 0;
  let right = readings.length;
  while (left < right) {
    const middle = Math.floor((left + right) / 2);
    const point = readings[middle];
    if (!point) return null;
    if (point.timestamp < timestamp) left = middle + 1;
    else right = middle;
  }
  let best: Reading | null = null;
  for (const point of [readings[left - 1], readings[left]]) {
    if (!point) continue;
    const distance = Math.abs(point.timestamp - timestamp);
    if (distance > (point.kind === "actual" ? 90 : 180)) continue;
    if (!best || distance < Math.abs(best.timestamp - timestamp)) best = point;
  }
  return best;
}
