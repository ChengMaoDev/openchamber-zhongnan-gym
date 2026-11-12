import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { HistoryFile } from "../shared/history-file";

export async function saveHistoryFile(file: HistoryFile, directory = join(homedir(), "Downloads")) {
  await mkdir(directory, { recursive: true });
  const date = new Date(file.exportedAt * 1000 + 28800000)
    .toISOString()
    .slice(0, 19)
    .replaceAll(":", "-");
  const path = join(directory, `zhongnan-gym-${date}-${randomUUID().slice(0, 8)}.json`);
  await writeFile(path, JSON.stringify(file), { flag: "wx", mode: 0o600 });
  return { fileName: basename(path), path };
}

export async function revealHistoryFile(path: string): Promise<void> {
  const [command, args] =
    process.platform === "darwin"
      ? ["/usr/bin/open", ["-R", path]]
      : process.platform === "win32"
        ? ["explorer.exe", [`/select,${path}`]]
        : ["xdg-open", [dirname(path)]];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
