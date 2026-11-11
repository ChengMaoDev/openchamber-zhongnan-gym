import type { Sample } from "../shared/domain";

export type Point = Readonly<{ timestamp: number; count: number }>;

export function displayTraces(samples: readonly Sample[]): Point[][] {
  const traces: Point[][] = [];
  let points: Point[] = [];
  let bucket: Sample[] = [];
  let previous: number | null = null;
  const flush = () => {
    if (!bucket.length) return;
    points.push({
      timestamp: bucket.reduce((sum, sample) => sum + sample.timestamp, 0) / bucket.length,
      count: bucket.reduce((sum, sample) => sum + sample.count, 0) / bucket.length,
    });
    bucket = [];
  };
  for (const sample of samples) {
    if (previous !== null && sample.timestamp - previous > 90) {
      flush();
      traces.push(points);
      points = [];
    }
    if (bucket[0] && Math.floor(sample.timestamp / 180) !== Math.floor(bucket[0].timestamp / 180))
      flush();
    bucket.push(sample);
    previous = sample.timestamp;
  }
  flush();
  if (points.length) {
    const last = samples.at(-1);
    if (last && last.timestamp !== points.at(-1)?.timestamp) points.push(last);
    traces.push(points);
  }
  return traces;
}
