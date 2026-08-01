import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

const ROOT = process.cwd();

describe("full decision timeline in the DEMO dashboard", () => {
  it("renders a decision timeline fed by a public, admin-free endpoint", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Cronología de decisiones");
    expect(html).toContain("decisionTimelineList");
    expect(html).toContain("function renderDecisionTimeline");
    expect(html).toContain("function loadDecisionTimeline");
    expect(html).toContain("fetch('/api/decisions'");
  });

  it("shows the full six-vote committee detail per evaluated trade", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Comité por operación");
    expect(html).toContain("committeeVoteDetail");
    expect(html).toContain("function renderCommitteeVoteDetail");
    expect(html).toContain("entry.votes");
  });

  it("shows a purely informational readiness/manifest card without new Kraken calls", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Piloto: readiness y manifiesto");
    expect(html).toContain("function renderPilotInfo");
    expect(html).toContain("eligibleForLiveReview");
    expect(html).not.toContain("krakenSafetySummary");
    expect(html).not.toContain("buildPilotOneShotManifest");
    expect(html).not.toContain("buildPilotRuntimeReadiness");
  });

  it("keeps auto-refresh independent from the core demo loading loop", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("loadDecisionTimeline();setInterval(loadDecisionTimeline,15000);");
    expect(html).not.toContain("/api/pilot/submit");
    expect(html).not.toContain("LIVE_TRADING_ENABLED");
  });

  it("emits syntactically valid browser JavaScript", async () => {
    const html = await (await demoDashboard()).text();
    const match = html.match(/<script>([\s\S]*?)<\/script>/);

    expect(match).not.toBeNull();
    expect(() => new Function(match?.[1] ?? "")).not.toThrow();
  });

  it("exposes /api/decisions publicly, forwarding to the same source as the admin /api/signals, without altering its auth", () => {
    const index = readFileSync(join(ROOT, "src/index.ts"), "utf8");

    expect(index).toContain('url.pathname === "/api/decisions"');
    expect(index).toContain('singleton(env).fetch("https://bot/signals")');
    expect(index).toMatch(
      /url\.pathname === "\/api\/decisions"\) return singleton\(env\)\.fetch\("https:\/\/bot\/signals"\);/,
    );
    expect(index).toMatch(
      /if \(request\.method === "GET" && url\.pathname === "\/api\/signals"\) \{\s*\n\s*if \(!isAuthorized\(request, env\)\)/,
    );
  });
});
