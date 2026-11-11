import { expect, test } from "bun:test";
import { displayTraces } from "../src/panel/trace";

test("轻度平滑减少显示点且不改动数据，时间浮动不会误断线", () => {
  const samples = Array.from({ length: 60 }, (_, minute) => ({
    timestamp: 600 + minute * 60 + (minute % 3),
    count: minute + 30,
  }));
  const traces = displayTraces(samples);
  expect(traces).toHaveLength(1);
  expect(traces[0]?.length).toBeLessThan(30);
  expect(traces[0]?.at(-1)).toEqual(samples.at(-1));
  expect(samples).toHaveLength(60);
});

test("真正缺失观测时保留空档", () => {
  expect(
    displayTraces([
      { timestamp: 600, count: 10 },
      { timestamp: 660, count: 20 },
      { timestamp: 840, count: 30 },
    ]),
  ).toHaveLength(2);
});
