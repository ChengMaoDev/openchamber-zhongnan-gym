import { minuteOf, type Sample, weekday } from "../shared/domain";
import { median } from "./data";
import { at, solve } from "./linear";

function features(timestamp: number): number[] {
  const day = weekday(timestamp);
  const angle = (minuteOf(timestamp) * 2 * Math.PI) / 1440;
  const row = [1];
  for (let harmonic = 1; harmonic <= 6; harmonic++)
    row.push(Math.sin(harmonic * angle), Math.cos(harmonic * angle));
  for (let current = 0; current < 7; current++) row.push(Number(current === day));
  for (let harmonic = 1; harmonic <= 2; harmonic++)
    row.push(
      Number(day >= 5) * Math.sin(harmonic * angle),
      Number(day >= 5) * Math.cos(harmonic * angle),
    );
  for (let current = 0; current < 7; current++) {
    for (let harmonic = 1; harmonic <= 2; harmonic++)
      row.push(
        Number(day === current) * Math.sin(harmonic * angle),
        Number(day === current) * Math.cos(harmonic * angle),
      );
  }
  return row;
}

export class Profile {
  private constructor(
    private readonly coefficients: Float64Array | null,
    private readonly means: readonly (readonly number[])[],
    private readonly slots: ReadonlySet<number>,
  ) {}

  static fit(samples: readonly Sample[], alpha: number | null): Profile {
    const nearby = new Map<number, Sample[]>();
    for (const sample of samples) {
      const slot = Math.floor(minuteOf(sample.timestamp) / 5);
      for (let target = Math.max(0, slot - 3); target < Math.min(288, slot + 4); target++) {
        const group = nearby.get(target) ?? [];
        group.push(sample);
        nearby.set(target, group);
      }
    }
    const means = Array.from({ length: 7 }, (_, day) =>
      Array.from({ length: 288 }, (_, slot) => {
        const nearbySamples = nearby.get(slot) ?? [];
        const matching = nearbySamples.filter((sample) => weekday(sample.timestamp) === day);
        const pool = matching.length >= 4 ? matching : nearbySamples;
        return pool.length ? pool.reduce((sum, sample) => sum + sample.count, 0) / pool.length : 0;
      }),
    );
    const slots = new Set(nearby.keys());
    if (alpha === null) return new Profile(null, means, slots);
    const size = 52;
    const matrix = new Float64Array(size * size);
    const targets = new Float64Array(size);
    const newest = samples.at(-1)?.timestamp;
    if (newest === undefined) throw new Error("训练样本为空");
    for (const sample of samples) {
      const row = features(sample.timestamp);
      const weight = Math.exp(-(newest - sample.timestamp) / 864000);
      for (let i = 0; i < size; i++) {
        const value = at(row, i) * weight;
        targets[i] = at(targets, i) + value * sample.count;
        for (let j = 0; j <= i; j++)
          matrix[i * size + j] = at(matrix, i * size + j) + value * at(row, j);
      }
    }
    for (let i = 0; i < size; i++) {
      matrix[i * size + i] = at(matrix, i * size + i) + (i === 0 ? 0.001 : alpha);
      for (let j = 0; j < i; j++) matrix[j * size + i] = at(matrix, i * size + j);
    }
    return new Profile(solve(matrix, targets), means, slots);
  }

  predict(timestamp: number): number {
    const coefficients = this.coefficients;
    if (coefficients === null) {
      const row = this.means[weekday(timestamp)];
      if (!row) throw new Error("星期均值缺失");
      return at(row, Math.floor(minuteOf(timestamp) / 5));
    }
    return Math.max(
      0,
      features(timestamp).reduce((sum, value, i) => sum + value * at(coefficients, i), 0),
    );
  }

  supported(timestamp: number): boolean {
    return this.slots.has(Math.floor(minuteOf(timestamp) / 5));
  }

  corrected(times: readonly number[], today: readonly Sample[], issued: number): number[] {
    const recent = today.filter(
      (sample) => sample.timestamp <= issued && issued - sample.timestamp <= 1800,
    );
    const correction = recent.length
      ? median(recent.map((sample) => sample.count - this.predict(sample.timestamp)))
      : 0;
    return times.map((timestamp) =>
      Math.max(
        0,
        this.predict(timestamp) + correction * Math.exp(-Math.max(0, timestamp - issued) / 5400),
      ),
    );
  }
}

export function daysByWeekday(days: readonly string[]): number[] {
  return Array.from(
    { length: 7 },
    (_, day) =>
      days.filter((date) => weekday(Date.parse(`${date}T12:00:00+08:00`) / 1000) === day).length,
  );
}
