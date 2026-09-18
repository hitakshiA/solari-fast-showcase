// The baseline arm: the Codex CLI on this machine (signed in with ChatGPT, GPT-6 Astra)
// driving Solari through Solari's own MCP server, the way a Solari user would run it.
//
// It runs headless with only Solari's MCP server loaded (the user's own config is ignored)
// and with its shell in the read-only sandbox; Solari's MCP calls are auto-approved
// instead of opening full access.
//
//   node --env-file=.env lib/codex-arm.ts "<prompt>"

import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
/** Solari's MCP server as published, and our fork with the observe/act tools. */
export const MCP_SERVERS = {
  stock: join(HERE, "../codex/node_modules/@solarisdk/mcp/dist/cli.js"),
  fast: join(HERE, "../../solari-mcp/dist/cli.js"),
} as const;

export interface CodexToolCall {
  tool: string;
  arguments: unknown;
  status: string;
  /** Seconds since the run started, when the call finished. */
  atS: number;
}

export interface CodexRun {
  model: string;
  exitCode: number | null;
  seconds: number;
  toolCalls: CodexToolCall[];
  finalMessage: string;
  usage: { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningTokens: number };
  events: unknown[];
}

export interface CodexArmOptions {
  prompt: string;
  solariApiKey: string;
  model?: string;
  effort?: "low" | "medium" | "high";
  /** Which Solari MCP server Codex gets. Default "stock". */
  mcp?: keyof typeof MCP_SERVERS;
  /** Hard stop, in ms. Default 60 minutes. */
  budgetMs?: number;
  onToolCall?: (call: CodexToolCall) => void;
}

export function runCodex(o: CodexArmOptions): Promise<CodexRun> {
  const model = o.model ?? "gpt-6-astra";
  const args = [
    "exec", "--ignore-user-config", "--skip-git-repo-check", "--ephemeral", "--json",
    "-m", model,
    "-c", `model_reasoning_effort="${o.effort ?? "medium"}"`,
    "-c", 'approval_policy="never"', "-s", "read-only",
    "-c", 'mcp_servers.solari.command="node"',
    "-c", `mcp_servers.solari.args=[${JSON.stringify(MCP_SERVERS[o.mcp ?? "stock"])}]`,
    "-c", `mcp_servers.solari.env={SOLARI_API_KEY=${JSON.stringify(o.solariApiKey)}}`,
    "-c", "mcp_servers.solari.startup_timeout_sec=60",
    "-c", "mcp_servers.solari.tool_timeout_sec=180",
    "-c", 'mcp_servers.solari.default_tools_approval_mode="approve"',
    o.prompt,
  ];
  const started = performance.now();
  const run: CodexRun = {
    model, exitCode: null, seconds: 0, toolCalls: [], finalMessage: "",
    usage: { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningTokens: 0 }, events: [],
  };
  return new Promise((resolve) => {
    // stdin must be closed, or `codex exec` waits to read more of the prompt from it.
    const child = spawn("codex", args, { stdio: ["ignore", "pipe", "pipe"] });
    const budget = setTimeout(() => child.kill("SIGTERM"), o.budgetMs ?? 60 * 60_000);
    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        let event: { type?: string; item?: Record<string, unknown>; usage?: Record<string, number> };
        try { event = JSON.parse(line); } catch { continue; }
        run.events.push(event);
        const item = event.item;
        if (event.type === "item.completed" && item?.type === "mcp_tool_call") {
          const call: CodexToolCall = {
            tool: String(item.tool), arguments: item.arguments, status: String(item.status),
            atS: Math.round((performance.now() - started) / 100) / 10,
          };
          run.toolCalls.push(call);
          o.onToolCall?.(call);
        }
        if (event.type === "item.completed" && item?.type === "agent_message") run.finalMessage = String(item.text);
        if (event.type === "turn.completed" && event.usage) {
          run.usage.inputTokens += event.usage.input_tokens ?? 0;
          run.usage.cachedInputTokens += event.usage.cached_input_tokens ?? 0;
          run.usage.outputTokens += event.usage.output_tokens ?? 0;
          run.usage.reasoningTokens += event.usage.reasoning_output_tokens ?? 0;
        }
      }
    });
    child.stderr.resume();
    child.on("close", (code) => {
      clearTimeout(budget);
      run.exitCode = code;
      run.seconds = Math.round((performance.now() - started) / 100) / 10;
      resolve(run);
    });
  });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const [prompt, mcp = "stock"] = process.argv.slice(2);
  if (!prompt) throw new Error('usage: lib/codex-arm.ts "<prompt>" [stock|fast]');
  const r = await runCodex({
    prompt,
    mcp: mcp as keyof typeof MCP_SERVERS,
    solariApiKey: process.env.SOLARI_API_KEY ?? "",
    onToolCall: (c) => console.log(`${c.atS.toFixed(1).padStart(6)}s  ${c.status.padEnd(9)} ${c.tool} ${JSON.stringify(c.arguments).slice(0, 110)}`),
  });
  console.log(`\nexit ${r.exitCode} in ${r.seconds}s, ${r.toolCalls.length} tool calls`);
  console.log(`final: ${r.finalMessage.slice(0, 300)}`);
  console.log(`usage: ${JSON.stringify(r.usage)}`);
  const dir = `runs/codex-${mcp}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/run.json`, JSON.stringify({ prompt, ...r }, null, 2));
  console.log(`trace saved to ${dir}`);
}
