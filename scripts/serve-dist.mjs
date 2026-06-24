import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../dist", import.meta.url));
const port = Number(process.env.PORT || process.argv[2] || 5177);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
};

function resolvePath(url) {
  const cleanUrl = decodeURIComponent(url.split("?")[0]);
  const requested = cleanUrl === "/" ? "/index.html" : cleanUrl;
  const normalized = normalize(join(root, requested));
  if (!normalized.startsWith(root)) return join(root, "index.html");
  return normalized;
}

createServer(async (request, response) => {
  try {
    const path = resolvePath(request.url || "/");
    const body = await readFile(path);
    response.writeHead(200, {
      "content-type": mimeTypes[extname(path)] || "application/octet-stream",
      "cache-control": "no-store",
    });
    response.end(body);
  } catch {
    const body = await readFile(join(root, "index.html"));
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    });
    response.end(body);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`Ritual Covenant preview: http://127.0.0.1:${port}/`);
});
