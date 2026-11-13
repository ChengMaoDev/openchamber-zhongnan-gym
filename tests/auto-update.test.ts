import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { packageManifestSchema } from "@openchamber/sdk/schemas";
import manifest from "../package.json";
import { updatedPanelUrl } from "../src/panel/version";
import { AutoUpdater } from "../src/service/auto-update";
import { cleanupDirectory } from "./cleanup";

const assets = [
  "panel/index.html",
  "panel/main.js",
  "panel/style.css",
  "service/main.cjs",
  "service/model-worker.cjs",
  "icon.svg",
];
const parts = manifest.version.split(".");
const nextVersion = `${parts[0]}.${parts[1]}.${Number(parts[2]) + 1}`;
const git = (cwd: string, args: string[]) =>
  execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

async function scenario(
  run: (context: {
    source: string;
    installed: string;
    updater: AutoUpdater;
    updated: () => number;
    publish: (change?: (next: typeof manifest) => void) => void;
  }) => Promise<void>,
) {
  const directory = mkdtempSync(join(tmpdir(), "gym-update-"));
  const source = join(directory, "source");
  const installed = join(directory, "extensions", "zhongnan-gym");
  mkdirSync(source);
  git(source, ["init", "-b", "main"]);
  git(source, ["config", "user.email", "test@example.invalid"]);
  git(source, ["config", "user.name", "测试"]);
  writeFileSync(join(source, "package.json"), JSON.stringify(manifest));
  for (const path of assets) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    writeFileSync(join(source, path), "fixture");
  }
  git(source, ["add", "."]);
  git(source, ["commit", "-m", "初始测试版本"]);
  mkdirSync(dirname(installed));
  const remote = pathToFileURL(source).href;
  git(directory, ["clone", "--quiet", "--depth", "1", remote, installed]);
  let updated = 0;
  const updater = new AutoUpdater(
    installed,
    async () => {
      updated++;
    },
    remote,
  );
  try {
    await run({
      source,
      installed,
      updater,
      updated: () => updated,
      publish(change) {
        const next = structuredClone(manifest);
        next.version = nextVersion;
        change?.(next);
        writeFileSync(join(source, "package.json"), JSON.stringify(next));
        if (existsSync(join(source, "panel/main.js")))
          writeFileSync(join(source, "panel/main.js"), `fixture ${nextVersion}`);
        git(source, ["add", "."]);
        git(source, ["commit", "-m", "新的测试版本"]);
      },
    });
  } finally {
    updater.stop();
    cleanupDirectory(directory);
  }
}

test("自动拉取同一来源的新版本并触发重启，重复检查不重复更新", async () => {
  await scenario(async ({ installed, updater, updated, publish }) => {
    publish();
    // Match the host's own update check, which fetches only the new tip.
    git(installed, ["fetch", "--depth", "1", "origin", "HEAD"]);
    expect(await updater.check()).toBe(true);
    expect(
      packageManifestSchema.parse(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")))
        .version,
    ).toBe(nextVersion);
    expect(readFileSync(join(installed, "panel/main.js"), "utf8")).toBe(`fixture ${nextVersion}`);
    expect(updated()).toBe(1);
    expect(await updater.check()).toBe(false);
    expect(updated()).toBe(1);
  });
});

test("自动更新不覆盖本地修改", async () => {
  await scenario(async ({ installed, updater, updated, publish }) => {
    publish();
    writeFileSync(join(installed, "panel/main.js"), "local changes");
    expect(await updater.check()).toBe(false);
    expect(readFileSync(join(installed, "panel/main.js"), "utf8")).toBe("local changes");
    expect(updated()).toBe(0);
  });
});

test("自动更新不会绕过新增权限的宿主批准", async () => {
  await scenario(async ({ installed, updater, updated, publish }) => {
    publish((next) => {
      Object.assign(next.openchamber.contributes, { capabilities: ["files"] });
    });
    expect(await updater.check()).toBe(false);
    expect(
      packageManifestSchema.parse(JSON.parse(readFileSync(join(installed, "package.json"), "utf8")))
        .version,
    ).toBe(manifest.version);
    expect(updated()).toBe(0);
  });
});

test("固定到标签的安装不自动切换分支", async () => {
  await scenario(async ({ installed, updater, updated, publish }) => {
    git(installed, ["switch", "--detach"]);
    publish();
    expect(await updater.check()).toBe(false);
    expect(updated()).toBe(0);
  });
});

test("更新缺少打包文件时保留现有可用版本", async () => {
  await scenario(async ({ source, installed, updater, updated, publish }) => {
    git(source, ["rm", "panel/main.js"]);
    publish();
    await expect(updater.check()).rejects.toThrow();
    expect(readFileSync(join(installed, "panel/main.js"), "utf8")).toBe("fixture");
    expect(updated()).toBe(0);
  });
});

test("自动更新后刷新面板时保留宿主URL参数并避免刷新循环", () => {
  expect(updatedPanelUrl("https://host/panel?grant=example", "0.1.5", "0.1.6")).toBe(
    "https://host/panel?grant=example&gym-version=0.1.6",
  );
  expect(updatedPanelUrl("https://host/panel?gym-version=0.1.6", "0.1.5", "0.1.6")).toBeNull();
  expect(updatedPanelUrl("https://host/panel", "0.1.5", "0.1.5")).toBeNull();
});
