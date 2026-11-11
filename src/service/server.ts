import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { Prediction } from "../shared/domain";
import { dayOf, dayStart, nowSeconds } from "../shared/domain";
import type { ViewData } from "../shared/schema";
import type { Store } from "./store";

export function createService(
  token: string,
  store: Store,
  predictor: Readonly<{ prediction: Prediction | null; error: string | null }>,
  imported: number,
) {
  const expected = Buffer.from(`Bearer ${token}`);
  return createServer((request, response) => {
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Cache-Control", "no-store");
    const received = Buffer.from(request.headers.authorization ?? "");
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      response.writeHead(401).end(JSON.stringify({ error: "服务连接未授权" }));
      return;
    }
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method !== "GET") {
      response.writeHead(405).end();
      return;
    }
    if (url.pathname === "/health") {
      response.end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname !== "/view") {
      response.writeHead(404).end();
      return;
    }
    try {
      const current = nowSeconds();
      const today = dayOf(current);
      const day = url.searchParams.get("day") || today;
      const timestamp = dayStart(day);
      if (timestamp > current || timestamp < dayStart(today) - 30 * 86400) {
        response.writeHead(400).end(JSON.stringify({ error: "日期超出最近30天" }));
        return;
      }
      const original = predictor.prediction;
      const prediction = original && current - original.issuedAt <= 180 ? original : null;
      const body: ViewData = {
        day,
        today,
        status: store.status(current),
        samples: store.day(day, current),
        prediction: prediction
          ? {
              ...prediction,
              points: [...prediction.points],
              weekdayDays: [...prediction.weekdayDays],
            }
          : null,
        modelError: predictor.error,
        imported,
      };
      response.end(JSON.stringify(body));
    } catch (error) {
      console.error("读取健身记录失败", error);
      response.writeHead(400).end(JSON.stringify({ error: "无法读取该日期记录" }));
    }
  });
}
