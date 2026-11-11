import { minuteOf, nowSeconds } from "../shared/domain";
import type { ViewData } from "../shared/schema";
import { chartReadings, forecastTraces, visibleForecast } from "./chart-data";
import { curvePath } from "./curve";
import { attachHover } from "./hover";
import { displayTraces, type Point } from "./trace";

const NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attributes: Record<string, string>,
): SVGElementTagNameMap[K] {
  const element = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

export function drawChart(root: HTMLElement, data: ViewData, compact: boolean): void {
  const width = 360;
  const height = compact ? 145 : 190;
  const plot = { x: 28, y: 15, width: 310, height: height - 42 };
  const current = nowSeconds();
  const estimates = visibleForecast(data, current);
  const values = [
    ...data.samples.map((sample) => sample.count),
    ...estimates.map((point) => point.upper ?? point.count),
  ];
  const maximum = Math.max(20, Math.ceil(Math.max(0, ...values) / 20) * 20);
  const x = (timestamp: number) => plot.x + (minuteOf(timestamp) / 1440) * plot.width;
  const y = (count: number) => plot.y + plot.height * (1 - count / maximum);
  const picture = svg("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true" });
  for (const fraction of [0, 0.5, 1]) {
    const level = plot.y + plot.height * (1 - fraction);
    picture.append(
      svg("line", {
        x1: String(plot.x),
        x2: String(plot.x + plot.width),
        y1: String(level),
        y2: String(level),
        class: "grid",
      }),
    );
    const text = svg("text", {
      x: "22",
      y: String(level + 3),
      "text-anchor": "end",
      class: "axis",
    });
    text.textContent = String(Math.round(maximum * fraction));
    picture.append(text);
  }
  for (const hour of [0, 6, 12, 18, 24]) {
    const text = svg("text", {
      x: String(plot.x + (hour / 24) * plot.width),
      y: String(height - 7),
      "text-anchor": "middle",
      class: "axis",
    });
    text.textContent = `${String(hour).padStart(2, "0")}:00`;
    picture.append(text);
  }
  const pathFor = (points: readonly Point[], close = false, smooth = false) =>
    curvePath(
      points.map((point) => ({ x: x(point.timestamp), y: y(point.count) })),
      smooth,
    ) + (close ? " Z" : "");
  for (const points of forecastTraces(data, current)) {
    if (points.every((point) => point.lower !== null && point.upper !== null)) {
      const band = [
        ...points.map((point) => ({
          timestamp: point.timestamp,
          count: point.upper ?? point.count,
        })),
        ...[...points]
          .reverse()
          .map((point) => ({ timestamp: point.timestamp, count: point.lower ?? point.count })),
      ];
      picture.append(svg("path", { d: pathFor(band, true), class: "band" }));
    }
    picture.append(svg("path", { d: pathFor(points), class: "trace forecast" }));
  }
  for (const points of displayTraces(data.samples))
    picture.append(svg("path", { d: pathFor(points, false, true), class: "trace actual" }));
  const latest = data.samples.at(-1);
  if (latest)
    picture.append(
      svg("circle", {
        cx: String(x(latest.timestamp)),
        cy: String(y(latest.count)),
        r: "3",
        fill: "var(--gym-actual)",
      }),
    );
  if (!data.samples.length && !estimates.length) {
    const empty = svg("text", {
      x: String(width / 2),
      y: String(height / 2),
      "text-anchor": "middle",
      class: "axis",
    });
    empty.textContent = data.day === data.today ? "等待第一条人数记录" : "这一天没有记录";
    picture.append(empty);
  }
  root.replaceChildren(picture);
  attachHover(root, picture, data.day, chartReadings(data.samples, estimates), {
    width,
    height,
    plot,
    x,
    y,
  });
}
