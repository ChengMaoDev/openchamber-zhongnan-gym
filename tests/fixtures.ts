import { dayStart, type Sample } from "../src/shared/domain";

export const CURRENT = dayStart("2026-11-11") + 12 * 3600;

export function history(days: number, current = CURRENT): Sample[] {
  const samples: Sample[] = [];
  for (let offset = days; offset > 0; offset--) {
    const day = Math.floor((current + 28800) / 86400) * 86400 - 28800 - offset * 86400;
    for (let minute = 420; minute < 1380; minute += 5) {
      const hour = minute / 60;
      const noon = (hour - 12) / 2;
      const evening = (hour - 19) / 2;
      const count = Math.round(
        12 + 50 * Math.exp(-noon * noon) + 110 * Math.exp(-evening * evening),
      );
      samples.push({ timestamp: day + minute * 60, count });
    }
  }
  return samples;
}
