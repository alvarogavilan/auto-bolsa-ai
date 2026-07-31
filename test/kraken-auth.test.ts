import { describe, expect, it } from "vitest";
import { assessKrakenPermissions, signKrakenRequest } from "../src/kraken";

describe("Kraken API safety", () => {
  it("matches Kraken's official Spot REST signature vector", async () => {
    const signature = await signKrakenRequest(
      "/0/private/AddOrder",
      "1616492376594",
      "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25",
      "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==",
    );
    expect(signature).toBe(
      "4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==",
    );
  });

  it("accepts only the intended non-withdrawal permission set", () => {
    expect(
      assessKrakenPermissions([
        "query-funds",
        "query-open-trades",
        "query-closed-trades",
        "modify-trades",
        "close-trades",
      ]),
    ).toEqual({ safe: true, missing: [], forbidden: [] });
  });

  it("rejects withdrawal access even when every required permission exists", () => {
    const result = assessKrakenPermissions([
      "query-funds",
      "query-open-trades",
      "query-closed-trades",
      "modify-trades",
      "close-trades",
      "withdraw-funds",
    ]);
    expect(result.safe).toBe(false);
    expect(result.forbidden).toContain("withdraw-funds");
  });
});
