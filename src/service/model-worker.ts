import { parentPort } from "node:worker_threads";
import { z } from "zod";
import { Forecaster } from "../model/forecast";
import { sampleSchema } from "../shared/schema";

const port = parentPort;
if (!port) throw new Error("预测内核需要工作线程");
const model = new Forecaster();
const input = z.object({ samples: z.array(sampleSchema), current: z.number() });
port.on("message", (raw: unknown) => {
  try {
    const request = input.parse(raw);
    port.postMessage({ prediction: model.predict(request.samples, request.current) });
  } catch (error) {
    port.postMessage({ error: error instanceof Error ? error.message : "预测失败" });
  }
});
