import { WorkerEntrypoint } from "cloudflare:workers";
import { toolDeclarations, toolForProxy } from "./registry";
import type { Env, ToolDef } from "./registry";
import { liveToolsFor } from "./runtime";
import { tokenStillActive, trackCall } from "./store";
import { isRecord, OpError } from "./util";

interface SandboxProps {
  tokenId: string;
  scope: "read" | "write";
}

const NAMESPACES = ["gsc", "ga4", "bing", "pagespeed"];

export class WebmasterCodeSandbox extends WorkerEntrypoint<Env> {
  async callTool(namespace: string, method: string, args: Record<string, unknown>): Promise<unknown> {
    const props = this.ctx.props as SandboxProps;
    if (!props?.tokenId) throw new Error("credential rejected");
    const active = await tokenStillActive(this.env, props.tokenId);
    if (!active) throw new Error("credential rejected");
    const tools = await liveToolsFor(this.env);
    const tool = toolForProxy(tools, namespace, method);
    if (!tool) {
      throw new Error(
        `Unknown or unconfigured tool: ${namespace}.${method}. The connector may not be connected in setup.`,
      );
    }
    if (tool.write && active.scope !== "write") {
      throw new Error(`${tool.name} needs a write-scope token; this token is read-only.`);
    }
    try {
      return await tool.handler({ env: this.env, tokenId: active.id, scope: active.scope }, args ?? {});
    } catch (e) {
      throw new Error(e instanceof OpError ? e.message : `Internal error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

const BOOTSTRAP = `
import { WorkerEntrypoint } from "cloudflare:workers";
import { run } from "./user-code.js";
export class Agent extends WorkerEntrypoint {
  async run() {
    const BRIDGE = this.env.BRIDGE;
    const logs = [];
    const toolCalls = [];
    let started = 0;
    let logChars = 0;
    const fmt = (a) => {
      if (typeof a === "string") return a.slice(0, 2000);
      try { return JSON.stringify(a).slice(0, 2000); } catch (e) { return String(a).slice(0, 2000); }
    };
    const captureLog = (line) => {
      if (logs.length >= 100 || logChars >= 32768) return;
      const text = line.slice(0, Math.min(2000, 32768 - logChars));
      logs.push(text);
      logChars += text.length;
    };
    const capture = {
      log(...a) { captureLog(a.map(fmt).join(" ")); },
      info(...a) { captureLog(a.map(fmt).join(" ")); },
      warn(...a) { captureLog("WARN: " + a.map(fmt).join(" ")); },
      error(...a) { captureLog("ERROR: " + a.map(fmt).join(" ")); },
    };
    const makeProxy = (namespace) => new Proxy({}, {
      get(t, name) {
        if (name === "then") return undefined;
        const method = String(name);
        return async (args) => {
          if (started >= 50) throw new Error("execute tool-call limit reached");
          started++;
          const t0 = Date.now();
          try {
            const r = await BRIDGE.callTool(namespace, method, args || {});
            toolCalls.push({ tool: namespace + "_" + method, ms: Date.now() - t0 });
            return r;
          } catch (e) {
            toolCalls.push({ tool: namespace + "_" + method, ms: Date.now() - t0, error: String((e && e.message) || e).slice(0, 500) });
            throw e;
          }
        };
      },
    });
    const api = {};
    for (const ns of ${JSON.stringify(NAMESPACES)}) api[ns] = makeProxy(ns);
    let outcome;
    try {
      const value = await run(api, capture);
      let out = null;
      try {
        const serialized = JSON.stringify(value);
        if (serialized && serialized.length > 32768) throw new Error("result too large");
        out = serialized === undefined ? null : JSON.parse(serialized);
      } catch (e) { out = "[result omitted: not serializable or too large]"; }
      outcome = { ok: true, value: out, logs, toolCalls };
    } catch (e) {
      outcome = { ok: false, error: String((e && e.message) || e).slice(0, 2000), logs, toolCalls };
    }
    return outcome;
  }
}
`;

interface Outcome {
  ok: boolean;
  value?: unknown;
  error?: string;
  logs: unknown[];
  toolCalls: { tool: string; ms: number; error?: string }[];
}

function parseOutcome(v: unknown): Outcome {
  if (!isRecord(v)) return { ok: false, error: "sandbox returned nothing", logs: [], toolCalls: [] };
  const calls = Array.isArray(v.toolCalls) ? v.toolCalls : [];
  return {
    ok: v.ok === true,
    value: v.value,
    ...(typeof v.error === "string" ? { error: v.error } : {}),
    logs: Array.isArray(v.logs) ? v.logs : [],
    toolCalls: calls.flatMap((tc: unknown) =>
      isRecord(tc) && typeof tc.tool === "string" && typeof tc.ms === "number"
        ? [{ tool: tc.tool, ms: tc.ms, ...(typeof tc.error === "string" ? { error: tc.error } : {}) }]
        : [],
    ),
  };
}

type WaitCtx = { waitUntil(p: Promise<unknown>): void; exports?: unknown };

export async function runExecute(
  env: Env,
  ctx: WaitCtx,
  code: string,
  auth: { tokenId: string; scope: "read" | "write" },
): Promise<{ content: { type: string; text: string }[]; isError?: boolean }> {
  const started = Date.now();
  const fail = (text: string) => {
    trackCall(ctx, env, "execute", started, text.slice(0, 200), auth.tokenId);
    return { content: [{ type: "text", text }], isError: true };
  };
  if (!code.trim()) return fail("Error: code is required.");
  if (code.length > 200_000) return fail("Error: code exceeds 200KB.");
  if (!env.LOADER) return fail("Error: the code-execution sandbox is not configured on this worker.");
  const exportsObj = ctx.exports;
  const sandboxExport = isRecord(exportsObj) ? exportsObj.WebmasterCodeSandbox : undefined;
  if (typeof sandboxExport !== "function") return fail("Error: sandbox entrypoint unavailable.");
  let worker: WorkerStub;
  try {
    const props: SandboxProps = { tokenId: auth.tokenId, scope: auth.scope };
    const bridge: unknown = Reflect.apply(sandboxExport, undefined, [{ props }]);
    worker = env.LOADER.load({
      compatibilityDate: "2026-10-06",
      mainModule: "bootstrap.js",
      modules: {
        "bootstrap.js": BOOTSTRAP,
        "user-code.js": `export async function run({ gsc, ga4, bing, pagespeed }, console) {\n${code}\n}`,
      },
      env: { BRIDGE: bridge },
      globalOutbound: null,
    });
  } catch (e) {
    return fail(`Error: failed to start sandbox: ${e instanceof Error ? e.message : String(e)}`.slice(0, 300));
  }
  let result: unknown;
  try {
    const entry = worker.getEntrypoint("Agent", { limits: { cpuMs: 1000, subRequests: 50 } });
    const runPromise = Promise.resolve((entry as unknown as { run(): Promise<unknown> }).run());
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error("execution timed out after 10s")), 10_000);
    });
    try {
      result = await Promise.race([runPromise, timeout]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  } catch (e) {
    return fail(`Error: ${e instanceof Error ? e.message : String(e)}`.slice(0, 500));
  }
  const r = parseOutcome(result);
  for (const tc of r.toolCalls) {
    trackCall(ctx, env, tc.tool, Date.now() - tc.ms, tc.error ?? null, auth.tokenId);
  }
  if (!r.ok) return fail(`Error: ${r.error ?? "unknown error"}`);
  trackCall(ctx, env, "execute", started, null, auth.tokenId);
  return {
    content: [
      { type: "text", text: JSON.stringify({ value: r.value, logs: r.logs, toolCalls: r.toolCalls }, null, 2) },
    ],
  };
}
