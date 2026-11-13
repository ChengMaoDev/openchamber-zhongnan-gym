import { connectHost, type HostReadyContext } from "@openchamber/sdk";
import { applyHostReady } from "@openchamber/sdk/ui";
import { version } from "../../package.json";
import { dayOf, dayStart, RETENTION_SECONDS, ZONE } from "../shared/domain";
import { type ViewData, viewSchema } from "../shared/schema";
import { drawChart } from "./chart";
import { createControls } from "./controls";
import { mountHistoryTransfer } from "./history-transfer";
import { updatedPanelUrl } from "./version";

function element(id: string): HTMLElement {
  const result = document.getElementById(id);
  if (!result) throw new Error(`界面元素缺失：${id}`);
  return result;
}

const host = connectHost();
let mounted = false;
let compact = false;
let day = dayOf(Date.now() / 1000);
let followingToday = true;
let data: ViewData | null = null;
let active = false;
let pending = false;
let disposed = false;
let controls: ReturnType<typeof createControls> | null = null;
let readError: string | null = null;
let historyTransfer: ReturnType<typeof mountHistoryTransfer> | null = null;
const time = new Intl.DateTimeFormat("zh-CN", {
  timeZone: ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function select(offset: number): void {
  const today = dayOf(Date.now() / 1000);
  day = clampDay(dayOf(dayStart(day) + offset * 86400), today);
  followingToday = day === today;
  void load();
}

function clampDay(selected: string, today: string): string {
  const earliest = dayOf(dayStart(today) - RETENTION_SECONDS);
  return selected < earliest ? earliest : selected > today ? today : selected;
}

function paint(): void {
  const today = data?.today ?? dayOf(Date.now() / 1000);
  element("date").textContent =
    `${day === today ? "今天 " : ""}${day.slice(5, 7)} 月 ${day.slice(8)} 日`;
  controls?.previous.update({ disabled: day <= dayOf(dayStart(today) - RETENTION_SECONDS) });
  controls?.next.update({ disabled: day >= today });
  element("today").hidden = day === today;
  if (!data) {
    element("notice").textContent = readError ?? "";
    element("updated").textContent = readError ? "等待连接恢复" : "正在连接…";
    return;
  }
  element("count").textContent = data.status.count === null ? "—" : String(data.status.count);
  element("updated").textContent =
    data.status.updatedAt === null
      ? "等待采集"
      : `${time.format(data.status.updatedAt * 1000)} 更新${data.status.stale || readError ? " · 等待恢复" : ""}`;
  element("updated").title = readError ?? data.status.error ?? "";
  const loadingDay = data.day !== day;
  element("chart").setAttribute("aria-busy", String(loadingDay));
  if (loadingDay) {
    element("chart").replaceChildren();
    element("summary").textContent = "正在读取…";
  } else if (data.samples.length) {
    const peak = data.samples.reduce((best, sample) => (sample.count > best.count ? sample : best));
    const mean = data.samples.reduce((sum, sample) => sum + sample.count, 0) / data.samples.length;
    element("summary").textContent =
      `最高 ${peak.count} 人 / ${time.format(peak.timestamp * 1000)}　均值 ${mean.toFixed(0)} 人`;
  } else element("summary").textContent = "暂无记录";
  const prediction = data.prediction;
  element("model").textContent = data.modelError
    ? "预测暂不可用"
    : !prediction?.trainingDays
      ? data.modelPending
        ? "正在更新预测…"
        : "记录 1 天后开始预测"
      : `已学习 ${prediction.trainingDays} 天${prediction.mae === null ? " · 待回测" : ` · 回测误差 ${prediction.mae.toFixed(1)} 人`}`;
  element("model").title =
    prediction?.weekdayDays
      .map((count, index) => `周${"一二三四五六日"[index]} ${count} 天`)
      .join(" · ") ?? "按星期与工作日/周末持续学习";
  element("notice").textContent =
    readError ??
    (data.modelError ? "预测暂不可用，下次采集后重试" : (data.historyImportError ?? ""));
  if (!loadingDay) drawChart(element("chart"), data, compact);
  if (compact) host.setHeight(Math.min(320, element("app").scrollHeight + 8));
}

async function load(): Promise<void> {
  if (disposed || !mounted) return;
  const today = dayOf(Date.now() / 1000);
  day = followingToday ? today : clampDay(day, today);
  pending = true;
  paint();
  if (active) return;
  active = true;
  controls?.refresh.update({ loading: true });
  try {
    while (pending && !disposed) {
      pending = false;
      const requested = day;
      const requestToday = followingToday;
      try {
        const reply = await host.serviceRequest({
          method: "GET",
          path: "/view",
          query: requestToday ? {} : { day: requested },
        });
        if (disposed) return;
        if (reply.status !== 200) throw new Error("暂时无法读取记录");
        const raw: unknown = JSON.parse(reply.body);
        const result = viewSchema.parse(raw);
        const nextPanel = updatedPanelUrl(window.location.href, version, result.version);
        if (nextPanel) {
          window.location.replace(nextPanel);
          return;
        }
        if (requested !== day) {
          pending = true;
          continue;
        }
        data = result;
        if (requestToday) day = result.today;
        readError = null;
        paint();
      } catch (error) {
        if (disposed) return;
        if (requested !== day) {
          pending = true;
          continue;
        }
        readError = error instanceof Error ? error.message : "扩展服务暂不可用";
        paint();
      }
    }
  } finally {
    active = false;
    if (!disposed) controls?.refresh.update({ loading: false });
  }
}

async function refreshImportedHistory(): Promise<void> {
  await load();
  for (let attempt = 0; attempt < 60 && !disposed && data?.modelPending; attempt++) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 500));
    await load();
  }
}

function ready(context: HostReadyContext): void {
  applyHostReady(context, document.documentElement);
  document.documentElement.dataset.mode = context.theme.mode;
  document.body.dataset.surface = context.surface;
  compact = context.surface === "status";
  element("history-transfer").hidden = compact;
  if (!compact && !historyTransfer)
    historyTransfer = mountHistoryTransfer(
      element("history-transfer"),
      host,
      refreshImportedHistory,
    );
  if (mounted) {
    paint();
    return;
  }
  controls = createControls(
    element,
    select,
    () => {
      day = dayOf(Date.now() / 1000);
      followingToday = true;
      void load();
    },
    () => void load(),
  );
  mounted = true;
  void load();
}

host.onReady(ready);
const timer = window.setInterval(() => {
  if (!document.hidden && mounted) void load();
}, 60000);
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && mounted) void load();
});
window.addEventListener(
  "pagehide",
  () => {
    disposed = true;
    window.clearInterval(timer);
    if (controls) for (const control of Object.values(controls)) control.dispose();
    historyTransfer?.dispose();
    host.dispose();
  },
  { once: true },
);
