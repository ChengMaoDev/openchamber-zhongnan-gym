import { describe, expect, test } from "bun:test";
import { Forecaster } from "../src/model/forecast";
import { at, solve } from "../src/model/linear";
import { Profile } from "../src/model/profile";
import { dayStart, type Sample, weekday } from "../src/shared/domain";
import { CURRENT, history } from "./fixtures";

describe("本地预测", () => {
  test("没有历史不生成虚构曲线，1个有效日就能开始", () => {
    expect(new Forecaster().predict([], CURRENT).points).toHaveLength(0);
    const forecast = new Forecaster().predict(history(1), CURRENT);
    expect(forecast.trainingDays).toBe(1);
    expect(forecast.points.length).toBeGreaterThan(100);
    expect(forecast.mae).toBeNull();
  });

  test("零散记录不当作有效训练日", () => {
    const sparse = Array.from({ length: 10 }, (_, day) => ({
      timestamp: CURRENT - (day + 1) * 86400,
      count: 30,
    }));
    expect(new Forecaster().predict(sparse, CURRENT).points).toHaveLength(0);
  });

  test("同一天补充历史后，预测曲线与用完整数据重新训练的结果一致", () => {
    const model = new Forecaster();
    const original = history(1).map((sample) => ({ ...sample, count: 20 }));
    const imported = history(2).map((sample) => ({
      ...sample,
      count: sample.timestamp < dayStart("2026-11-10") ? 120 : 20,
    }));
    const before = model.predict(original, CURRENT);
    const after = model.predict(imported, CURRENT);
    const fresh = new Forecaster().predict(imported, CURRENT);
    expect(after.trainingDays).toBe(2);
    expect(after.points).toEqual(fresh.points);
    expect(after.points[0]?.count).toBeGreaterThan((before.points[0]?.count ?? 0) + 20);
  });

  test("历史样本数量和时间不变、人数变化时，也不能继续使用旧模型", () => {
    const model = new Forecaster();
    const original = history(1).map((sample) => ({ ...sample, count: 20 }));
    model.predict(original, CURRENT);
    const updated = original.map((sample) => ({ ...sample, count: 120 }));
    expect(model.predict(updated, CURRENT).points).toEqual(
      new Forecaster().predict(updated, CURRENT).points,
    );
  });

  test("未来数据不泄漏进模型，只预测当日后续且非负", () => {
    const samples = history(3);
    const original = new Forecaster().predict(samples, CURRENT);
    const poisoned = new Forecaster().predict(
      [...samples, { timestamp: CURRENT + 3600, count: 99999 }],
      CURRENT,
    );
    expect(poisoned).toEqual(original);
    for (const point of original.points) {
      expect(point.timestamp).toBeGreaterThan(CURRENT);
      expect(point.timestamp).toBeLessThan(dayStart("2026-11-12"));
      expect(point.count).toBeGreaterThanOrEqual(0);
    }
  });

  test("今日实时偏差会修正后续预测", () => {
    const samples = history(3);
    const baseline = new Forecaster().predict(samples, CURRENT);
    const today = Array.from({ length: 6 }, (_, index) => ({
      timestamp: CURRENT - index * 300,
      count: 120,
    }));
    const updated = new Forecaster().predict([...samples, ...today], CURRENT);
    expect(updated.points[0]?.count).toBeGreaterThan((baseline.points[0]?.count ?? 0) + 30);
  });

  test("滚动回测给出实测误差与误差范围", () => {
    const forecast = new Forecaster().predict(history(8), CURRENT);
    expect(forecast.mae).not.toBeNull();
    expect(forecast.mae).toBeLessThan(15);
    expect(forecast.points.every((point) => point.lower !== null && point.upper !== null)).toBe(
      true,
    );
  });

  test("周一到周日分别学习，周末可有不同水平", () => {
    const start = dayStart("2026-10-12");
    const samples: Sample[] = [];
    for (let day = 0; day < 21; day++) {
      for (let minute = 420; minute < 1380; minute += 5) {
        const timestamp = start + day * 86400 + minute * 60;
        samples.push({
          timestamp,
          count: 30 + weekday(timestamp) * 10 + (weekday(timestamp) >= 5 ? 80 : 0),
        });
      }
    }
    const model = Profile.fit(samples, 1);
    const monday = start + 21 * 86400 + 43200;
    expect(model.predict(monday + 3 * 86400)).toBeGreaterThan(model.predict(monday) + 20);
    expect(model.predict(monday + 5 * 86400)).toBeGreaterThan(model.predict(monday) + 100);
    expect(model.predict(monday + 6 * 86400)).toBeGreaterThan(
      model.predict(monday + 5 * 86400) + 5,
    );
  });

  test("回归求解器有独立的解析解校验", () => {
    const result = solve(new Float64Array([4, 1, 1, 3]), new Float64Array([1, 2]));
    expect(at(result, 0)).toBeCloseTo(1 / 11, 10);
    expect(at(result, 1)).toBeCloseTo(7 / 11, 10);
  });

  test("没有同星期样本时，工作日不会混用周末高峰", () => {
    const samples: Sample[] = [];
    for (const [day, count] of [
      ["2026-11-06", 40],
      ["2026-11-07", 200],
      ["2026-11-08", 200],
    ] as const) {
      for (let minute = 420; minute < 1380; minute += 5) {
        samples.push({ timestamp: dayStart(day) + minute * 60, count });
      }
    }
    const model = Profile.fit(samples, null);
    expect(model.predict(dayStart("2026-11-09") + 12 * 3600)).toBeCloseTo(40);
  });
});
