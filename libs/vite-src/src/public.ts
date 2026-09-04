import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createLogUpdate } from "log-update";
import {
  normalizePath,
  type Logger,
  type ModuleNode,
  type ViteDevServer,
} from "vite";

export type JsonObject = Record<string, unknown>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type RevisionMessage<Entry extends string> = {
  scope: string;
  session: string;
  entry: Entry;
  revision: number;
  instance?: string;
};

export const jsonLiteral = (value: unknown, label: string): string => {
  const visiting = new Set<object>();
  const validate = (candidate: unknown, path: string): void => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") return;
    if (typeof candidate === "number") {
      if (!Number.isFinite(candidate)) throw new TypeError(`${path} must contain only finite numbers`);
      return;
    }
    if (typeof candidate !== "object") throw new TypeError(`${path} must be JSON serializable`);
    if (visiting.has(candidate)) throw new TypeError(`${path} must not contain circular references`);
    visiting.add(candidate);
    if (Array.isArray(candidate)) {
      candidate.forEach((item, index) => validate(item, `${path}[${index}]`));
    } else {
      const prototype = Object.getPrototypeOf(candidate);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError(`${path} must contain only plain objects`);
      }
      for (const [key, item] of Object.entries(candidate)) validate(item, `${path}.${key}`);
    }
    visiting.delete(candidate);
  };
  validate(value, label);
  return JSON.stringify(value);
};

export const envDefine = (value: unknown, label: string): Record<string, string> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  return { env: jsonLiteral(value, label) };
};

export const definesAssertAvailable = (
  define: Record<string, unknown> | undefined,
  plugin: string,
): void => {
  if (define && Object.keys(define).some(key => key === "env" || key === "typeof env" || key.startsWith("env."))) {
    throw new TypeError(`${plugin} owns the env compile-time constant`);
  }
};

export const objectFileRead = (path: string, label: string): JsonObject => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} cannot be read: ${path}; ${String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new TypeError(`${label} must contain a JSON object: ${path}`);
  }
  return parsed as JsonObject;
};

export const objectFileWrite = (path: string, value: JsonObject): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
};

export const requiredString = (value: unknown, label: string, path: string): string => {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required: ${path}`);
  return value.trim();
};

export const fileAssert = (path: string, label: string): string => {
  if (!existsSync(path) || !statSync(path).isFile()) {
    throw new Error(`${label} does not exist or is not a file: ${path}`);
  }
  return path;
};

export const directoryAssert = (path: string, label: string): string => {
  if (!existsSync(path) || !statSync(path).isDirectory()) {
    throw new Error(`${label} does not exist or is not a directory: ${path}`);
  }
  return path;
};

export const entryPathRead = (
  root: string,
  value: string,
  expectedExtension: ".ts" | ".tsx",
  label: string,
): string => {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} must be a non-empty path`);
  const path = normalizePath(isAbsolute(value) ? resolve(value) : resolve(root, value));
  if (extname(path).toLowerCase() !== expectedExtension) {
    throw new TypeError(`${label} must reference a ${expectedExtension} file: ${path}`);
  }
  return normalizePath(fileAssert(path, label));
};

export const absoluteFileRead = (value: string, fileName: string, label: string): string => {
  if (typeof value !== "string" || !isAbsolute(value)) {
    throw new TypeError(`${label} must be an absolute path: ${String(value)}`);
  }
  const path = resolve(value);
  if (path.split(/[\\/]/u).at(-1)?.toLowerCase() !== fileName.toLowerCase()) {
    throw new TypeError(`${label} must end with ${fileName}: ${value}`);
  }
  return fileAssert(path, label);
};

export const viteImportId = (file: string, command: "serve" | "build"): string => {
  const absolute = resolve(file);
  return command === "serve"
    ? `/@fs/${normalizePath(absolute)}`
    : pathToFileURL(absolute).href;
};

export const viteHtmlEntryUrl = (
  htmlFile: string,
  entryFile: string,
  command: "serve" | "build",
): string => {
  if (command === "serve") return viteImportId(entryFile, "serve");
  const relativeEntry = normalizePath(relative(dirname(resolve(htmlFile)), resolve(entryFile)));
  return relativeEntry.startsWith(".") ? relativeEntry : `./${relativeEntry}`;
};

// Runtime-specific packages supply their own default icon path.
// Common Vite helpers shared by runtime-specific plugin packages.
export const iconPathRead = (
  root: string,
  value: unknown,
  label: string,
  packagePath: string,
  exactSize?: number,
  defaultPath?: string,
): {
  path: string;
  fileName: string;
} => {
  const path = value === undefined
    ? fileAssert(defaultPath ?? resolve(root, "icon.png"), `${label} default icon`)
    : (() => {
      const icon = requiredString(value, `${label} package.json icon`, packagePath);
      return fileAssert(isAbsolute(icon) ? resolve(icon) : resolve(root, icon), `${label} icon`);
    })();
  if (extname(path).toLowerCase() !== ".png") {
    throw new Error(`${label} icon must be a PNG file: ${path}`);
  }
  const image = readFileSync(path);
  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (
    image.length < 24
    || pngSignature.some((byte, index) => image[index] !== byte)
    || image.toString("ascii", 12, 16) !== "IHDR"
  ) {
    throw new Error(`${label} icon is not a valid PNG file: ${path}`);
  }
  const width = image.readUInt32BE(16);
  const height = image.readUInt32BE(20);
  if (width !== height || (exactSize === undefined ? width < 128 : width !== exactSize)) {
    const size = exactSize === undefined ? "at least 128x128" : `${exactSize}x${exactSize}`;
    throw new Error(`${label} icon must be a square ${size} PNG: ${path} (${width}x${height})`);
  }
  return { path, fileName: "icon.png" };
};

export const htmlEscape = (value: string): string => value.replace(/[&<>"']/gu, character => ({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  "\"": "&quot;",
  "'": "&#39;",
}[character] ?? character));

export const directoryFiles = (directory: string, base = directory): Record<string, Uint8Array> => {
  const files: Record<string, Uint8Array> = {};
  for (const item of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, item.name);
    if (item.isDirectory()) Object.assign(files, directoryFiles(path, base));
    else if (item.isFile()) files[relative(base, path).replace(/\\/gu, "/")] = readFileSync(path);
  }
  return files;
};

export const directoryCopy = (source: string, target: string): void => {
  directoryAssert(source, "build output");
  for (const item of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = resolve(source, item.name);
    const targetPath = resolve(target, item.name);
    if (item.isDirectory()) directoryCopy(sourcePath, targetPath);
    else if (item.isFile()) {
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, readFileSync(sourcePath));
    }
  }
};

export const modulesReachFile = (modules: readonly ModuleNode[], file: string): boolean => {
  const pending = [...modules];
  const visited = new Set<ModuleNode>();
  while (pending.length) {
    const module = pending.pop();
    if (!module || visited.has(module)) continue;
    visited.add(module);
    if (module.file && normalizePath(module.file) === file) return true;
    pending.push(...module.importers);
  }
  return false;
};

export const modulesInvalidate = (
  server: ViteDevServer,
  modules: readonly ModuleNode[],
  timestamp: number,
): void => {
  const invalidated = new Set<ModuleNode>();
  for (const module of modules) server.moduleGraph.invalidateModule(module, invalidated, timestamp, true);
};

export const devOriginRead = (server: ViteDevServer, plugin: string): string => {
  const local = server.resolvedUrls?.local[0];
  if (local) return new URL(local).origin;
  const address = server.httpServer?.address();
  if (address && typeof address === "object") return `http://127.0.0.1:${address.port}`;
  throw new Error(`${plugin} cannot determine the Vite dev server URL`);
};

export const devFileUrl = (file: string, timestamp: number): string => {
  const path = encodeURI(normalizePath(file)).replace(/#/gu, "%23").replace(/\?/gu, "%3F");
  return `/@fs/${path}?t=${timestamp}`;
};

export type ViteHtmlProject = {
  readonly name: string;
  readonly html: string;
};

type ViteHtmlRequest = {
  readonly method?: string;
  readonly url?: string;
  readonly headers: { readonly accept?: string };
};

type ViteHtmlResponse = {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(body?: string): void;
};

type ViteHtmlServer = {
  middlewares: {
    use(handler: (
      request: ViteHtmlRequest,
      response: ViteHtmlResponse,
      next: (error?: unknown) => void,
    ) => unknown): unknown;
  };
  transformIndexHtml(url: string, html: string): Promise<string>;
};

export const viteHtmlMiddleware = (
  server: ViteHtmlServer,
  projects: readonly ViteHtmlProject[],
  origin: string,
): void => {
  server.middlewares.use(async (request, response, next) => {
    try {
      if (request.method !== "GET" || !request.url) return next();
      const url = new URL(request.url, origin);
      const project = projects.find(({ name }) => (
        url.pathname === `/${name}` || url.pathname.startsWith(`/${name}/`)
      ));
      if (!project) return next();
      if (url.pathname === `/${project.name}`) {
        response.statusCode = 307;
        response.setHeader("Location", `/${project.name}/${url.search}`);
        response.end();
        return;
      }
      if (!request.headers.accept?.includes("text/html")) return next();
      const html = await server.transformIndexHtml(
        url.pathname,
        readFileSync(project.html, "utf8"),
      );
      response.statusCode = 200;
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(html);
    } catch (error) {
      next(error);
    }
  });
};

export const originListRead = (values: readonly string[] | undefined, label: string): string[] => [
  ...new Set((values ?? []).map(value => {
    if (typeof value !== "string" || !value.trim()) throw new TypeError(`${label} cannot contain an empty origin`);
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new TypeError(`${label} must contain valid origins: ${value}`);
    }
    if (!["http:", "https:", "ws:", "wss:"].includes(url.protocol)
      || url.pathname !== "/" || url.search || url.hash) {
      throw new TypeError(`${label} must contain HTTP(S) or WS(S) origins: ${value}`);
    }
    return url.origin;
  })),
];

export class RuntimeStatus<Entry extends string> {
  readonly plugin: string;
  readonly entries: readonly Entry[];
  readonly session = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  readonly latest = new Map<Entry, number>();
  readonly running = new Map<Entry, Map<string, { message: RevisionMessage<Entry>; seenAt: number }>>();
  readonly #renderInPlace = createLogUpdate(process.stdout, { showCursor: true });
  #lastSnapshot = "";
  #logger: Logger | undefined;
  #server: ViteDevServer | undefined;
  #scope = "";
  #expiryTimer: ReturnType<typeof setInterval> | undefined;

  constructor(plugin: string, entries: readonly Entry[]) {
    this.plugin = plugin;
    this.entries = entries;
    for (const entry of entries) {
      this.latest.set(entry, 1);
      this.running.set(entry, new Map());
    }
  }

  activate(server: ViteDevServer, logger: Logger, scope: string): void {
    this.#server = server;
    this.#logger = logger;
    this.#scope = scope;
    server.ws.on(`${this.plugin}:ack`, (message: RevisionMessage<Entry>) => this.acknowledge(message));
    if (this.#expiryTimer) clearInterval(this.#expiryTimer);
    this.#expiryTimer = setInterval(() => this.render(), 2000);
    server.httpServer?.once("close", () => {
      if (this.#expiryTimer) clearInterval(this.#expiryTimer);
      this.#expiryTimer = undefined;
    });
    this.render();
  }

  revision(entry: Entry): number {
    return this.latest.get(entry) ?? 1;
  }

  runtimeSource(entry: Entry): string {
    const revision = this.revision(entry);
    return [
      "const __viteStatusHot = import.meta.hot;",
      `const __viteStatusInstance = __viteStatusHot?.data.__viteStatusInstance ?? globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);`,
      `if (__viteStatusHot) __viteStatusHot.data.__viteStatusInstance = __viteStatusInstance;`,
      `let __viteStatusRevision = ${revision};`,
      `const __viteStatusAck = () => __viteStatusHot?.send(${JSON.stringify(`${this.plugin}:ack`)}, { scope: ${JSON.stringify(this.#scope)}, session: ${JSON.stringify(this.session)}, entry: ${JSON.stringify(entry)}, revision: __viteStatusRevision, instance: __viteStatusInstance });`,
      "__viteStatusHot?.on(\"vite:ws:connect\", __viteStatusAck);",
      `if (__viteStatusHot) { clearInterval(__viteStatusHot.data.__viteStatusHeartbeat); __viteStatusHot.data.__viteStatusHeartbeat = setInterval(__viteStatusAck, 2000); __viteStatusHot.dispose(data => clearInterval(data.__viteStatusHeartbeat)); }`,
    ].join("\n");
  }

  moduleUpdateRuntimeSource(entry: Entry, apply: string): string {
    return `__viteStatusHot?.on(${JSON.stringify(`${this.plugin}:module-update`)}, message => { if (message.scope !== ${JSON.stringify(this.#scope)} || message.session !== ${JSON.stringify(this.session)} || message.entry !== ${JSON.stringify(entry)}) return; import(/* @vite-ignore */ message.url).then(module => { ${apply}; __viteStatusRevision = message.revision; __viteStatusAck(); }).catch(error => { setTimeout(() => { throw error; }); }); });`;
  }

  moduleUpdate(entry: Entry, url: string): void {
    this.#server?.ws.send(`${this.plugin}:module-update`, {
      scope: this.#scope,
      session: this.session,
      entry,
      revision: this.revision(entry),
      url,
    });
  }

  changed(entries: readonly Entry[]): void {
    for (const entry of entries) this.latest.set(entry, this.revision(entry) + 1);
    this.render();
  }

  render(): void {
    if (!this.#logger) return;
    const now = Date.now();
    const rows = this.entries.map(entry => {
      const active = this.running.get(entry) ?? new Map();
      for (const [instance, state] of active) {
        if (now - state.seenAt > 6500) active.delete(instance);
      }
      const expected = this.revision(entry);
      const states = [...active.values()].map(value => value.message);
      const current = states.filter(message => message.session === this.session && message.revision === expected).length;
      const state = !states.length
        ? "○ 未连接，无法判断"
        : current === states.length
          ? `● 当前最新 (r${expected})${states.length > 1 ? ` · ${states.length} 个实例` : ""}`
          : current > 0
            ? `▲ ${states.length} 个实例：${current} 个最新 / ${states.length - current} 个需要刷新`
            : states.some(message => message.session !== this.session)
              ? `▲ Vite 已重启，${states.length} 个实例需要刷新`
              : `▲ 需要刷新 (最新 r${expected}，${states.length} 个实例仍是旧版本)`;
      return `${entry.padEnd(10)} ${state}`;
    });
    const snapshot = [`${this.plugin} status`, "", ...rows].join("\n");
    if (process.stdout.isTTY) this.#renderInPlace(snapshot);
    else if (snapshot !== this.#lastSnapshot) {
      this.#logger.info(`\n${snapshot}`);
      this.#lastSnapshot = snapshot;
    }
  }

  acknowledge(message: RevisionMessage<Entry>): void {
    if (
      message?.scope !== this.#scope
      || !this.entries.includes(message.entry)
      || !Number.isInteger(message.revision)
      || message.revision < 1
    ) {
      this.#logger?.warn(`[${this.plugin}] ignored an invalid runtime revision acknowledgement`);
      return;
    }
    const instance = message.instance?.trim() || `${message.session}:${message.entry}:legacy`;
    this.running.get(message.entry)?.set(instance, { message, seenAt: Date.now() });
    this.render();
  }
}
