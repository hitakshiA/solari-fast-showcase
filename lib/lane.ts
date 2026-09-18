// One lane of a showcase: a Solari browser running one goal with solari-reflex,
// recorded with the live overlay, its report saved next to the video.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  Advisor, BrowserPage, BrowserRecorder, JevClient, overlayFor, Planner, Policy, runTask, Solari, TextWriter,
  type CreateBrowserOptions, type TaskReport,
} from "solari-reflex";

export interface LaneSpec {
  name: string;
  startUrl: string;
  goal: string;
  browser?: CreateBrowserOptions;
  deny?: string[];
  maxSteps?: number;
}

export interface LaneResult {
  name: string;
  report: TaskReport;
  video?: string;
  dir: string;
}

export function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export async function runLane(spec: LaneSpec, runDir: string, log = true): Promise<LaneResult> {
  const solari = new Solari({ apiKey: env("SOLARI_API_KEY") });
  const key = env("OPENROUTER_API_KEY");
  const dir = join(runDir, spec.name);
  mkdirSync(dir, { recursive: true });
  const session = await solari.createBrowser(spec.browser ?? {});
  try {
    const page = await BrowserPage.connect(session.cdpEndpoint);
    await page.navigate(spec.startUrl);
    const recorder = new BrowserRecorder(page.cdp, { dir });
    await recorder.start();
    let spend = 0;
    const report = await runTask({
      page,
      goal: spec.goal,
      maxSteps: spec.maxSteps ?? 40,
      policy: new Policy(new JevClient({ apiKey: key }), { deny: spec.deny ?? [] }),
      writer: new TextWriter({ apiKey: key, model: "inception/mercury-2.5" }),
      advisor: new Advisor({ apiKey: key, model: "google/gemini-3.5-flash", reasoning: "minimal" }),
      planner: new Planner({ apiKey: key, model: "google/gemini-3.5-flash", reasoning: "minimal" }),
      onDecision: (d, obs, ms) => {
        spend += d.cost ?? 0;
        return page.showOverlay(overlayFor(obs, d, `${spec.name} · ${d.source} · ${(ms / 1000).toFixed(1)} s · $${spend.toFixed(4)}`));
      },
      onStep: (s) => {
        if (log) console.log(`[${spec.name}] ${(s.atMs / 1000).toFixed(1).padStart(5)}s ${s.decidedBy.padEnd(7)} ${s.confidence.toFixed(2)} ${s.action}`);
      },
    });
    await new Promise((r) => setTimeout(r, 800));
    const video = await recorder.stop();
    writeFileSync(join(dir, "report.json"), JSON.stringify({ ...spec, ...report }, null, 2));
    page.close();
    return { name: spec.name, report, dir, ...(video ? { video } : {}) };
  } finally {
    await solari.releaseBrowser(session.sessionId).catch(() => undefined);
  }
}
