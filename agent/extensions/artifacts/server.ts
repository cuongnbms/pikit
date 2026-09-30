/** Lazy localhost HTTP server: static artifact serving, index page, SSE live reload. */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";

import { HOST } from "./config.js";
import { listArtifacts, safeArtifactPath } from "./utils.js";
import { renderIndexPage } from "./templates.js";

interface ServerState {
  port: number | null;
  server: Server;
  clients: Set<ServerResponse>;
  startup?: Promise<number>;
  stopped: boolean;
  closing?: Promise<void>;
  shutdown?: Promise<void>;
}

// A port owns one immutable request root, including its index and SSE clients.
const states = new Map<string, ServerState>();
const retiring = new Set<ServerState>();

/** URL for a given slug (or index). Starts the project's server if needed. */
export async function artifactUrl(slug?: string, cwd = process.cwd()): Promise<string> {
  const port = await ensureServer(cwd);
  return slug ? `http://${HOST}:${port}/${slug}.html` : `http://${HOST}:${port}/`;
}

/** Push a reload event only to this project's connected SSE clients. */
export function notifyReload(slug: string, cwd = process.cwd()): void {
  const state = states.get(resolve(cwd));
  if (!state || state.port === null) return;
  const payload = `event: reload\ndata: ${slug}\n\n`;
  for (const res of state.clients) {
    try { res.write(payload); } catch { state.clients.delete(res); }
  }
}

/** Whether this project's server is currently running (not merely starting). */
export function isRunning(cwd = process.cwd()): boolean {
  return runningPort(cwd) !== null;
}

/** Current project port, else null. Does NOT start the server. */
export function runningPort(cwd = process.cwd()): number | null {
  return states.get(resolve(cwd))?.port ?? null;
}

/** Share one in-flight startup per project. Failed or cancelled starts can retry. */
export function ensureServer(cwd = process.cwd()): Promise<number> {
  const root = resolve(cwd);
  const existing = states.get(root);
  if (existing) return existing.startup!;

  const clients = new Set<ServerResponse>();
  const server = createServer((req, res) => handle(req, res, clients, root));
  const state: ServerState = { port: null, server, clients, stopped: false };
  states.set(root, state);
  state.startup = new Promise<number>((resolvePort, reject) => {
    server.once("error", reject);
    server.listen(0, HOST, () => {
      server.removeListener("error", reject);
      const addr = server.address();
      if (typeof addr !== "object" || !addr) {
        reject(new Error("Artifact server has no listening address"));
        return;
      }
      resolvePort(addr.port);
    });
  }).then(async (port) => {
    if (state.stopped) {
      await closeServer(state);
      throw new Error("Artifact server startup cancelled by shutdown");
    }
    state.port = port;
    return port;
  }).catch(async (error) => {
    // An old generation must never remove a newer project's server.
    if (states.get(root) === state) states.delete(root);
    await closeServer(state);
    throw error;
  });
  return state.startup;
}

/** Close a listening generation once; a pending listen is closed after it starts. */
function closeServer(state: ServerState): Promise<void> {
  for (const res of state.clients) { try { res.end(); } catch {} }
  state.clients.clear();
  if (state.closing) return state.closing;
  if (!state.server.listening) return Promise.resolve();
  state.closing = new Promise<void>((done) => {
    state.server.close(() => done());
    state.server.closeAllConnections();
  });
  return state.closing;
}

/** Stop all project servers, including in-flight starts and already retiring ones. */
export async function stopServer(): Promise<void> {
  const all = new Set([...states.values(), ...retiring]);
  states.clear();
  for (const state of all) {
    state.stopped = true;
    state.port = null;
    retiring.add(state);
    state.shutdown ??= (async () => {
      await closeServer(state);
      await state.startup!.catch(() => {});
      await closeServer(state);
    })().finally(() => retiring.delete(state));
  }
  await Promise.all([...all].map((state) => state.shutdown));
}

// ─── Request handler ──────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
};

function handle(req: IncomingMessage, res: ServerResponse, clients: Set<ServerResponse>, cwd: string): void {
  const url = (req.url ?? "/").split("?")[0];

  // SSE endpoint
  if (url === "/events") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");
    clients.add(res);
    req.on("close", () => clients.delete(res));
    return;
  }

  // Index page
  if (url === "/") {
    const entries = listArtifacts(cwd);
    const html = renderIndexPage(entries, cwd);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Static artifact file — normalize + prefix-check to prevent traversal outside artifacts dir
  const safe = safeArtifactPath(decodeURIComponent(url), cwd);
  if (!safe || !existsSync(safe) || !statSync(safe).isFile()) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404 — artifact not found");
    return;
  }

  const mime = MIME[extname(safe).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "Content-Type": mime });
  res.end(readFileSync(safe));
}