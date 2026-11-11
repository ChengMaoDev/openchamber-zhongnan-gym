import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 58744,
  fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
    const path = url.pathname === "/harness" ? "tests/harness.html" : url.pathname.slice(1);
    if (
      path !== "tests/harness.html" &&
      !["panel/index.html", "panel/main.js", "panel/style.css"].includes(path)
    )
      return new Response("Not found", { status: 404 });
    return new Response(Bun.file(resolve(root, path)));
  },
});
console.log(`扩展验收页面 http://${server.hostname}:${server.port}/harness`);
