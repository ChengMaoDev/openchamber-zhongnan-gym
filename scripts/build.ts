import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
await Promise.all(
  ["panel", "service"].map((name) => mkdir(resolve(root, name), { recursive: true })),
);
const licenses = await Promise.all(
  ["@openchamber/sdk", "zod"].map(
    async (name) =>
      `${name}\n${await Bun.file(resolve(root, "node_modules", name, "LICENSE")).text()}`,
  ),
);
const notice = `\n/*!\n${licenses.join("\n\n")}\n*/\n`;
for (const [source, target, platform, format] of [
  ["src/panel/main.ts", "panel/main.js", "browser", "iife"],
  ["src/service/main.ts", "service/main.cjs", "node", "cjs"],
  ["src/service/model-worker.ts", "service/model-worker.cjs", "node", "cjs"],
] as const) {
  const result = await Bun.build({
    entrypoints: [resolve(root, source)],
    target: platform,
    format,
    minify: true,
  });
  if (!result.success) throw new AggregateError(result.logs, `构建失败：${source}`);
  const output = result.outputs[0];
  if (!output) throw new Error(`构建未生成文件：${source}`);
  await Bun.write(resolve(root, target), `${await output.text()}${notice}`);
}
for (const file of ["index.html", "style.css"])
  await Bun.write(resolve(root, "panel", file), Bun.file(resolve(root, "src/panel", file)));
console.log("已构建 OpenChamber 面板和常驻采集服务");
