import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

describe("Kraken account cleanliness gate", () => {
  it("audits open orders only through the central BotState nonce authority", () => {
    const botState = read("src/bot-state.ts");

    expect(botState).toContain('super.fetch(new Request("https://bot/kraken/next-nonce"');
    expect(botState).toContain("const nonce = await this.nextCentralKrakenNonce()");
    expect(botState).toContain("const orders = await openOrders(");
    expect(botState).not.toContain("computeNextNonce");
    expect(botState).not.toContain("Date.now().toString()");
  });

  it("returns only a sanitized count and never exposes order identifiers", () => {
    const botState = read("src/bot-state.ts");
    const audit = botState.match(/private async freshOpenOrdersAudit[\s\S]*?\n  \}/)?.[0] ?? "";

    expect(audit).toContain("openOrderCount: orders.length");
    expect(audit).toContain("accountClean: orders.length === 0");
    expect(audit).toContain('permissionRequired: "query-open-trades"');
    expect(audit).toContain("readOnly: true");
    expect(audit).toContain("realOrderCreated: false");
    expect(audit).not.toMatch(/txid|clOrdId|price|volume/i);
  });

  it("builds proposal safety from BotState and fails closed on unknown open orders", () => {
    const safety = read("src/pilot-account-safety.ts");
    const proposal = read("src/pilot-validation-proposal.ts");

    expect(safety).toContain('stub.fetch("https://bot/kraken/connection")');
    expect(safety).toContain('stub.fetch("https://bot/kraken/permissions")');
    expect(safety).toContain("openOrderCount === 0");
    expect(proposal).toContain("fetchPilotAccountSafety(env)");
    expect(proposal).toContain("openOrderCount === null");
    expect(proposal).toContain("openOrderCount !== 0");
    expect(proposal).not.toContain("openOrders(");
  });
});
