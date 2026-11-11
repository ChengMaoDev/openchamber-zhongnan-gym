import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { parseManifestJson } from "@openchamber/sdk/schemas";

const root = resolve(import.meta.dir, "..");
const manifest = parseManifestJson(await Bun.file(resolve(root, "package.json")).text());
if (!manifest.ok) throw new Error(`扩展清单无效：${JSON.stringify(manifest)}`);
for (const name of [
  "panel/index.html",
  "panel/main.js",
  "panel/style.css",
  "service/main.cjs",
  "service/model-worker.cjs",
  "icon.svg",
]) {
  await access(resolve(root, name));
}
console.log("官方SDK扩展清单与所有安装文件通过检查");
