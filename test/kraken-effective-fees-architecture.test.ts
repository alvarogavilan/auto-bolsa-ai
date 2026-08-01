import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

describe("Kraken effective fee architecture", () => {
  it("obtains every fee-audit nonce from the BotState authority", () => {
    const wrapper = readFileSync(join(ROOT, "src/bot-state.ts"), "utf8");

    expect(wrapper).toContain('super.fetch(new Request("https://bot/kraken/next-nonce"');
    expect(wrapper).toContain("fetchKrakenEffectiveFees");
    expect(wrapper).not.toContain("computeNextNonce");
    expect(wrapper).not.toContain("Date.now().toString()");
  });

  it("adds fee information only after the base connection succeeds", () => {
    const wrapper = readFileSync(join(ROOT, "src/bot-state.ts"), "utf8");
    const baseConnection = wrapper.indexOf("const base = await super.fetch(request)");
    const feeCall = wrapper.indexOf("audit = await this.freshEffectiveFees()");

    expect(baseConnection).toBeGreaterThan(-1);
    expect(feeCall).toBeGreaterThan(baseConnection);
    expect(wrapper).toContain("if (!base.ok) return base");
    expect(wrapper).toContain("if (body.connected !== true) return base");
  });

  it("keeps fee failures fail-open for authentication and PAPER", () => {
    const wrapper = readFileSync(join(ROOT, "src/bot-state.ts"), "utf8");

    expect(wrapper).toContain("failOpenForConnection: true");
    expect(wrapper).toContain("realOrderCreated: false");
    expect(wrapper).toContain("readOnly: true");
    expect(wrapper).toContain("liveTrading: false");
    expect(wrapper).not.toContain("addOrder");
    expect(wrapper).not.toContain("submitOrder");
  });

  it("does not expose credentials in the fee audit module", () => {
    const module = readFileSync(join(ROOT, "src/kraken-fees.ts"), "utf8");

    expect(module).not.toContain("apiSecret:");
    expect(module).not.toContain("apiKey:");
    expect(module).toContain("readOnly: true");
    expect(module).toContain("realOrderCreated: false");
    expect(module).toContain("/0/private/TradeVolume");
  });
});
