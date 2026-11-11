import { dayStart, ZONE } from "../shared/domain";
import { nearestReading, type Reading } from "./chart-data";

type Layout = Readonly<{
  width: number;
  height: number;
  plot: Readonly<{ x: number; y: number; width: number; height: number }>;
  x: (timestamp: number) => number;
  y: (count: number) => number;
}>;

export function attachHover(
  root: HTMLElement,
  picture: SVGSVGElement,
  day: string,
  readings: readonly Reading[],
  layout: Layout,
): void {
  const tooltip = document.createElement("div");
  tooltip.className = "chart-tooltip";
  tooltip.setAttribute("role", "tooltip");
  tooltip.hidden = true;
  const title = document.createElement("strong");
  const detail = document.createElement("div");
  tooltip.append(title, detail);
  root.append(tooltip);
  const crosshair = document.createElementNS("http://www.w3.org/2000/svg", "line");
  crosshair.setAttribute("class", "chart-crosshair");
  crosshair.setAttribute("y1", String(layout.plot.y));
  crosshair.setAttribute("y2", String(layout.plot.y + layout.plot.height));
  crosshair.style.display = "none";
  const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  marker.setAttribute("r", "3.5");
  marker.setAttribute("class", "chart-hover-point");
  marker.style.display = "none";
  picture.append(crosshair, marker);
  const time = new Intl.DateTimeFormat("zh-CN", {
    timeZone: ZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const hide = () => {
    tooltip.hidden = true;
    crosshair.style.display = "none";
    marker.style.display = "none";
  };
  picture.addEventListener("pointerleave", hide);
  picture.addEventListener("pointermove", (event) => {
    const rect = picture.getBoundingClientRect();
    const px = ((event.clientX - rect.left) / rect.width) * layout.width;
    const py = ((event.clientY - rect.top) / rect.height) * layout.height;
    const plot = layout.plot;
    if (px < plot.x || px > plot.x + plot.width || py < plot.y || py > plot.y + plot.height) {
      hide();
      return;
    }
    const target = dayStart(day) + ((px - plot.x) / plot.width) * 86400;
    const point = nearestReading(readings, target);
    const timestamp = point?.timestamp ?? target;
    const x = point ? layout.x(timestamp) : px;
    crosshair.setAttribute("x1", String(x));
    crosshair.setAttribute("x2", String(x));
    crosshair.style.display = "";
    title.textContent = `${time.format(timestamp * 1000)} · ${point ? (point.kind === "actual" ? "实测" : "预测") : "暂无记录"}`;
    detail.textContent = point ? `${Math.round(point.count)} 人` : "—";
    marker.style.display = point ? "" : "none";
    if (point) {
      marker.setAttribute("cx", String(x));
      marker.setAttribute("cy", String(layout.y(point.count)));
      marker.setAttribute(
        "fill",
        point.kind === "actual" ? "var(--gym-actual)" : "var(--gym-forecast)",
      );
    }
    tooltip.hidden = false;
    const bounds = root.getBoundingClientRect();
    const available = root.clientWidth - tooltip.offsetWidth - 6;
    const left = Math.max(6, Math.min(event.clientX - bounds.left + 12, available));
    const pointY = point ? layout.y(point.count) : py;
    const vertical = rect.top - bounds.top + (pointY / layout.height) * rect.height;
    const top =
      vertical > tooltip.offsetHeight + 14 ? vertical - tooltip.offsetHeight - 12 : vertical + 12;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(4, Math.min(top, root.clientHeight - tooltip.offsetHeight - 4))}px`;
  });
}
