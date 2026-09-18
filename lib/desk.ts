// Run shell snippets on a Solari desktop over REST exec.
//   node --env-file=.env bench/desk.ts list
//   node --env-file=.env bench/desk.ts <sandboxId> '<bash>' [timeoutMs]
//   node --env-file=.env bench/desk.ts delete <sandboxId>
const BASE = "https://api.getsolari.com";
const key = process.env.SOLARI_API_KEY!;
async function call(method: string, path: string, body?: unknown) {
  const r = await fetch(BASE + path, { method, headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(180_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}
const [a, b, c] = process.argv.slice(2);
if (a === "list") {
  const j = await call("GET", "/sandboxes?state=running");
  for (const s of j.sandboxes ?? j.items ?? j) console.log(s.kind, s.state, s.createdAt, s.expiresAt, s.sandboxId);
} else if (a === "delete") {
  await call("DELETE", `/sandboxes/${b}`); console.log("deleted");
} else {
  const t = performance.now();
  const r = await call("POST", `/sandboxes/${a}/exec`, { cmd: "bash", args: ["-lc", b], timeoutMs: Number(c ?? 30_000) });
  console.log((r.stdout ?? "").trim());
  if (r.stderr?.trim()) console.log("[stderr]", r.stderr.trim().slice(0, 600));
  console.log(`[exit ${r.exitCode} in ${Math.round(performance.now() - t)} ms]`);
}
