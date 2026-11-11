import { expect, test } from "bun:test";
import { chartReadings, forecastTraces, nearestReading } from "../src/panel/chart-data";
import { curvePath } from "../src/panel/curve";
import { dayOf } from "../src/shared/domain";
import { viewSchema } from "../src/shared/schema";
import { CURRENT } from "./fixtures";

function example() {
  return viewSchema.parse({
    day: dayOf(CURRENT),
    today: dayOf(CURRENT),
    status: { count: 80, updatedAt: CURRENT, stale: false, error: null },
    samples: [{ timestamp: CURRENT, count: 80 }],
    prediction: {
      issuedAt: CURRENT,
      trainingDays: 1,
      method: "test",
      mae: null,
      weekdayDays: [1, 0, 0, 0, 0, 0, 0],
      points: [
        { timestamp: CURRENT + 300, count: 100, lower: 90, upper: 110 },
        { timestamp: CURRENT + 600, count: 120, lower: 110, upper: 130 },
      ],
    },
    modelError: null,
    imported: 0,
  });
}

test("预测虚线从最后实测点开始，接点人数和坐标一致", () => {
  const traces = forecastTraces(example(), CURRENT);
  expect(traces[0]?.[0]).toEqual({ timestamp: CURRENT, count: 80, lower: 80, upper: 80 });
  expect(traces[0]?.[1]?.timestamp).toBe(CURRENT + 300);
});

test("失效实测或未覆盖的时段不会被预测连线填满", () => {
  const data = example();
  data.status.stale = true;
  expect(forecastTraces(data, CURRENT)[0]?.[0]?.timestamp).toBe(CURRENT + 300);
  data.status.stale = false;
  data.samples = [{ timestamp: CURRENT - 600, count: 80 }];
  expect(forecastTraces(data, CURRENT)[0]?.[0]?.timestamp).toBe(CURRENT + 300);
});

test("鼠标读数区分原始实测和预测，缺口不编造人数", () => {
  const data = example();
  const readings = chartReadings(data.samples, data.prediction?.points ?? []);
  expect(nearestReading(readings, CURRENT + 30)).toMatchObject({
    timestamp: CURRENT,
    count: 80,
    kind: "actual",
  });
  expect(nearestReading(readings, CURRENT + 290)).toMatchObject({
    timestamp: CURRENT + 300,
    count: 100,
    kind: "forecast",
  });
  expect(nearestReading(readings, CURRENT - 600)).toBeNull();
});

test("显示平滑保留两端位置且使用柔和曲线", () => {
  const path = curvePath(
    [
      { x: 0, y: 10 },
      { x: 10, y: 30 },
      { x: 20, y: 15 },
    ],
    true,
  );
  expect(path.startsWith("M0.00,10.00")).toBe(true);
  expect(path.endsWith("Q20.00,15.00 20.00,15.00")).toBe(true);
  expect(path).toContain("Q10.00,30.00 15.00,22.50");
});
