import { describe, expect, it } from "vitest";
import { buildGlobalNewsPolicy } from "../src/global-news-source-policy";

describe("global market news source policy", () => {
  it("covers official, professional, specialist and social intelligence", () => {
    const policy = buildGlobalNewsPolicy();
    const tiers = policy.rules.map((rule) => rule.tier);

    expect(tiers).toContain("primary-official");
    expect(tiers).toContain("regulated-market");
    expect(tiers).toContain("professional-media");
    expect(tiers).toContain("specialist-intelligence");
    expect(tiers).toContain("social-lead");
    expect(policy.requiredClassification).toEqual([
      "impact",
      "confidence",
      "affected-assets",
      "estimated-duration",
      "historical-evidence",
      "paper-influence",
    ]);
  });

  it("treats X and social posts as leads that require corroboration", () => {
    const policy = buildGlobalNewsPolicy();
    const social = policy.rules.find((rule) => rule.tier === "social-lead");

    expect(social?.canConfirmFact).toBe(false);
    expect(social?.requiresCorroboration).toBe(true);
    expect(social?.maximumDecisionAuthority).toBe("context-only");
    expect(policy.safeguards.socialPostsAreLeadsNotFacts).toBe(true);
    expect(policy.safeguards.noTradeFromSingleHeadline).toBe(true);
  });

  it("keeps sizing with Treasury and real trading disabled", () => {
    const policy = buildGlobalNewsPolicy();

    expect(policy.safeguards.treasuryRetainsSizingAuthority).toBe(true);
    expect(policy.safeguards.liveOrdersDisabled).toBe(true);
    expect(policy.liveTrading).toBe(false);
  });
});
