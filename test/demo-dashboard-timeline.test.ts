import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

const ROOT = process.cwd();

describe("full decision timeline in the DEMO dashboard", () => {
  it("renders a decision timeline sourced from the committee impact report already in /api/lab", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Cronología de decisiones");
    expect(html).toContain("decisionTimelineList");
    expect(html).toContain("function renderDecisionTimeline");
    expect(html).toContain("lab.committeeImpact");
    expect(html).toContain("report.recentEntries");
    // /api/decisions returns the single-pair engine's raw signal ledger
    // (SignalEvidenceEntry), which has no symbol, decision or votes — using
    // it here produced "Evaluación" / "Sin decisión" / "0 votos registrados"
    // on every row. The timeline must not depend on it.
    expect(html).not.toContain("fetch('/api/decisions'");
  });

  it("shows the full committee vote detail per evaluated trade, from the real vote shape", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Comité por operación");
    expect(html).toContain("committeeVoteDetail");
    expect(html).toContain("entry.votes");
  });

  it("never renders an empty-looking entry: shows symbol, lane, verdict and outcome, or one explicit empty state", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("entry.symbol");
    expect(html).toContain("entry.verdict");
    expect(html).toContain("outcomeLabel(entry.outcome)");
    expect(html).toContain("Aún no hay operaciones evaluadas por el comité.");
  });

  it("refreshes the decision timeline as part of the normal render cycle, with no separate fetch to maintain", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("renderDecisionTimeline()");
    expect(html).toMatch(/function render\(\)\{[^}]*renderDecisionTimeline\(\)/);
    expect(html).not.toContain("function loadDecisionTimeline");
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
