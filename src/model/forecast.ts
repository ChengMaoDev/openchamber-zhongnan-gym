import { dayOf, dayStart, type Prediction, type Sample } from "../shared/domain";
import { bins, quantile, usableDays } from "./data";
import { daysByWeekday, Profile } from "./profile";

type Validation = Readonly<{ alpha: number | null; mae: number | null; spread: number | null }>;

function validate(samples: readonly Sample[], days: readonly string[]): Validation {
  if (days.length < 6) return { alpha: null, mae: null, spread: null };
  const candidates: Validation[] = [];
  for (const alpha of [null, 1, 10, 100]) {
    const errors: number[] = [];
    for (const day of days.slice(-3)) {
      const previous = samples.filter((sample) => dayOf(sample.timestamp) < day);
      if (!usableDays(previous).length) continue;
      const profile = Profile.fit(previous, alpha);
      const today = samples.filter((sample) => dayOf(sample.timestamp) === day);
      for (const hour of [9, 12, 15, 18]) {
        const issued = dayStart(day) + hour * 3600;
        const observed = today.filter((sample) => sample.timestamp <= issued);
        const future = today.filter(
          (sample) =>
            issued < sample.timestamp &&
            sample.timestamp <= issued + 21600 &&
            profile.supported(sample.timestamp),
        );
        const estimates = profile.corrected(
          future.map((sample) => sample.timestamp),
          observed,
          issued,
        );
        future.forEach((sample, index) => {
          const predicted = estimates[index];
          if (predicted === undefined) throw new Error("回测预测数量异常");
          errors.push(Math.abs(predicted - sample.count));
        });
      }
    }
    if (errors.length)
      candidates.push({
        alpha,
        mae: errors.reduce((sum, error) => sum + error, 0) / errors.length,
        spread: quantile(errors, 0.9),
      });
  }
  return (
    candidates.sort((a, b) => (a.mae ?? Infinity) - (b.mae ?? Infinity))[0] ?? {
      alpha: null,
      mae: null,
      spread: null,
    }
  );
}

export class Forecaster {
  private cachedDay = "";
  private cachedSamples: readonly Sample[] = [];
  private profile: Profile | null = null;
  private validation: Validation = { alpha: null, mae: null, spread: null };

  predict(raw: readonly Sample[], current: number): Prediction {
    const samples = bins(raw.filter((sample) => sample.timestamp <= current));
    const day = dayOf(current);
    const previous = samples.filter((sample) => dayOf(sample.timestamp) < day);
    const days = usableDays(previous);
    const common = {
      issuedAt: current,
      trainingDays: days.length,
      weekdayDays: daysByWeekday(days),
    };
    if (!days.length) return { ...common, points: [], method: "正在积累数据", mae: null };
    const historyChanged =
      previous.length !== this.cachedSamples.length ||
      previous.some((sample, index) => {
        const cached = this.cachedSamples[index];
        return !cached || sample.timestamp !== cached.timestamp || sample.count !== cached.count;
      });
    if (this.cachedDay !== day || this.profile === null || historyChanged) {
      this.validation = validate(previous, days);
      this.profile = Profile.fit(previous, this.validation.alpha);
      this.cachedDay = day;
      this.cachedSamples = previous;
    }
    const times: number[] = [];
    for (
      let stamp = (Math.floor(current / 300) + 1) * 300;
      stamp < dayStart(day) + 86400;
      stamp += 300
    ) {
      if (this.profile.supported(stamp)) times.push(stamp);
    }
    const today = samples.filter((sample) => dayOf(sample.timestamp) === day);
    const estimates = this.profile.corrected(times, today, current);
    const spread = this.validation.spread;
    const points = times.map((timestamp, index) => {
      const count = estimates[index];
      if (count === undefined) throw new Error("预测点数量异常");
      return {
        timestamp,
        count,
        lower: spread === null ? null : Math.max(0, count - spread),
        upper: spread === null ? null : count + spread,
      };
    });
    return {
      ...common,
      points,
      method: this.validation.alpha === null ? "时段均值" : "周期回归",
      mae: this.validation.mae,
    };
  }
}
