import { execFile } from "node:child_process";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { packageManifestSchema } from "@openchamber/sdk/schemas";

const execute = promisify(execFile);
const ORIGIN = "https://github.com/ChengMaoDev/openchamber-zhongnan-gym.git";
const INTERVAL_MS = 30 * 60_000;
const stableVersion = /^(\d+)\.(\d+)\.(\d+)$/;

function newer(next: string, previous: string): boolean {
  if (!stableVersion.test(next) || !stableVersion.test(previous)) return false;
  const left = next.split(".").map(Number);
  const right = previous.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) return difference > 0;
  }
  return false;
}

function grants(
  contributes: ReturnType<typeof packageManifestSchema.parse>["openchamber"]["contributes"],
): string {
  const { panel, statusSection, ...permissions } = contributes;
  return JSON.stringify(permissions);
}

export class AutoUpdater {
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private stopped = false;

  constructor(
    private readonly directory: string,
    private readonly updated: () => Promise<void>,
    private readonly origin = ORIGIN,
  ) {}

  private managed(): boolean {
    return (
      basename(this.directory) === "zhongnan-gym" &&
      basename(dirname(this.directory)) === "extensions"
    );
  }

  private async git(args: string[]): Promise<string> {
    const result = await execute("git", args, {
      cwd: this.directory,
      timeout: 30_000,
      maxBuffer: 512_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return result.stdout.trim();
  }

  start(): void {
    if (!this.managed() || this.timer || this.stopped) return;
    const check = () =>
      void this.check().catch((error: unknown) => console.error("检查健身扩展更新失败", error));
    this.timer = setInterval(check, INTERVAL_MS);
    this.timer.unref();
    check();
  }

  async check(): Promise<boolean> {
    if (!this.managed() || this.active || this.stopped) return false;
    this.active = true;
    try {
      return await this.install();
    } finally {
      this.active = false;
    }
  }

  private async install(): Promise<boolean> {
    const root = await this.git(["rev-parse", "--show-toplevel"]);
    if ((await realpath(root)) !== (await realpath(this.directory))) return false;
    const remote = await this.git(["remote", "get-url", "origin"]);
    const normalize = (value: string) =>
      value
        .replace(/\/$/, "")
        .replace(/\.git$/, "")
        .toLowerCase();
    if (normalize(remote) !== normalize(this.origin)) return false;
    if (await this.git(["status", "--porcelain"])) return false;
    if ((await this.git(["rev-parse", "--abbrev-ref", "HEAD"])) === "HEAD") return false;
    const upstream = await this.git([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    if (!upstream.startsWith("origin/")) return false;
    await this.git(["fetch", "--quiet", "origin"]);
    const target = await this.git(["rev-parse", upstream]);
    const current = packageManifestSchema.parse(
      JSON.parse(await readFile(join(this.directory, "package.json"), "utf8")),
    );
    const next = packageManifestSchema.parse(
      JSON.parse(await this.git(["show", `${target}:package.json`])),
    );
    if (!current.version || !next.version || !newer(next.version, current.version)) return false;
    if (next.openchamber.contributes.panel.id !== current.openchamber.contributes.panel.id)
      throw new Error("更新的扩展标识不一致");
    // New grants and a different host requirement go through OpenChamber's approval flow.
    if (
      JSON.stringify(next.openchamber.engines) !== JSON.stringify(current.openchamber.engines) ||
      grants(next.openchamber.contributes) !== grants(current.openchamber.contributes)
    )
      return false;
    for (const file of [
      "panel/index.html",
      "panel/main.js",
      "panel/style.css",
      "service/main.cjs",
      "service/model-worker.cjs",
      "icon.svg",
    ])
      await this.git(["cat-file", "-e", `${target}:${file}`]);
    // The host's depth-1 update check may hide the ancestry needed for a fast-forward.
    if ((await this.git(["rev-parse", "--is-shallow-repository"])) === "true")
      await this.git(["fetch", "--quiet", "--unshallow", "origin"]);
    if (this.stopped || (await this.git(["status", "--porcelain"]))) return false;
    await this.git(["merge", "--ff-only", "--no-edit", target]);
    if (!this.stopped) await this.updated();
    return true;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
