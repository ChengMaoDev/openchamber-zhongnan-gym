import { expand, RETENTION_SECONDS, type Segment } from "../shared/domain";

export function mergeHistory(
  existing: readonly Segment[],
  incoming: readonly Segment[],
  current: number,
) {
  const occupied = new Set(expand(existing).map((sample) => Math.floor(sample.timestamp / 60)));
  const cutoff = current - RETENTION_SECONDS;
  const clipped = incoming.flatMap((segment) => {
    const start = Math.max(cutoff, segment.start);
    const end = Math.min(current, segment.end);
    return start <= end ? [{ ...segment, start, end }] : [];
  });
  const segments: Segment[] = [];
  let added = 0;
  let skipped = 0;
  let previousMinute: number | null = null;
  for (const sample of expand(clipped)) {
    const minute = Math.floor(sample.timestamp / 60);
    if (occupied.has(minute)) {
      skipped++;
      previousMinute = null;
      continue;
    }
    occupied.add(minute);
    added++;
    const last = segments.at(-1);
    // Only coalesce uninterrupted imported observations; local rows are never rewritten.
    if (
      last &&
      previousMinute !== null &&
      minute === previousMinute + 1 &&
      last.count === sample.count &&
      sample.timestamp - last.end <= 90
    )
      segments[segments.length - 1] = { ...last, end: sample.timestamp };
    else segments.push({ start: sample.timestamp, end: sample.timestamp, count: sample.count });
    previousMinute = minute;
  }
  return { segments, added, skipped };
}
