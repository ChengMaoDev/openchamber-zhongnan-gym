import { rmSync } from "node:fs";

export function cleanupDirectory(path: string): void {
  // Bun's SQLite adapter defers prepared-statement cleanup; Windows keeps files locked until GC.
  Bun.gc(true);
  rmSync(path, { recursive: true, force: true, maxRetries: 8, retryDelay: 25 });
}
