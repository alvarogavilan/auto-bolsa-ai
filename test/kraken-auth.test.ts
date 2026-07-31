import { describe, expect, it } from "vitest";
import {
  assessKrakenPermissions,
  fingerprintKrakenCredentials,
  inspectKrakenCredentials,
  normalizeCredential,
  signKrakenRequest,
} from "../src/kraken";

const officialSecret =
  "kQH5HW/8p1uGOVjbgWA7FunAmGO8lsSUXNsu3eow76sz84Q18fWxnyRzBHCd3pd5nE9qa99HAZtuZuj6F1huXg==";

describe("Kraken API safety", () => {
  it("matches Kraken's official Spot REST signature vector", async () => {
    const signature = await signKrakenRequest(
      "/0/private/AddOrder",
      "1616492376594",
      "nonce=1616492376594&ordertype=limit&pair=XBTUSD&price=37500&type=buy&volume=1.25",
      officialSecret,
    );
    expect(signature).toBe(
      "4/dpxb3iT4tp/ZCVEwSnEsLxx0bqyhLpdfOpc6fn7OR8+UClSV5n9E6aSS8MPtnRfp32bAb0nmbRn6H8ndwLUQ==",
    );
  });

  it("signs the URL-encoded Balance probe deterministically", async () => {
    const signature = await signKrakenRequest(
      "/0/private/Balance",
      "1616492376594",
      "nonce=1616492376594",
      officialSecret,
    );
    expect(signature).toBe(
      "1nH4vwR+8FHiYh1QT649xXkGd3JR3x0DWkgv3u9Ed/Qqv6KPtgQpEU4m+Emb/VgpEji3j1XNwI+HCbfXxmrTOg==",
    );
  });

  it("signs the JSON body required by GetApiKeyInfo", async () => {
    const signature = await signKrakenRequest(
      "/0/private/GetApiKeyInfo",
      "1616492376594",
      '{"nonce":1616492376594}',
      officialSecret,
    );
    expect(signature).toBe(
      "Y+PfSbsXlj0sbAZDcyVp1igUnTeH91+HlgIEpJPjm/aBixgDgGhE06PvYLTJcj4blYBia7u1jnzYJXwj2zTODA==",
    );
  });

  it("removes spaces, zero-width characters, quotes and line breaks copied on iOS", () => {
    expect(normalizeCredential(` \"ab\u200Bcd\n ef\" `)).toBe("abcdef");
  });

  it("reports safe local diagnostics without exposing the API secret", () => {
    const diagnostics = inspectKrakenCredentials(" ABCD 1234\n", ` \"${officialSecret}\"\n`);
    expect(diagnostics.apiKeyLast4).toBe("1234");
    expect(diagnostics.apiSecretBase64Valid).toBe(true);
    expect(diagnostics.apiSecretDecodedBytes).toBe(64);
    expect(JSON.stringify(diagnostics)).not.toContain(officialSecret);
  });

  it("creates identical fingerprints after iPhone copy artefacts are removed", async () => {
    const clean = await fingerprintKrakenCredentials("ABCD1234", officialSecret);
    const copied = await fingerprintKrakenCredentials(" ABCD\u200B1234\n", ` \"${officialSecret}\"\n`);
    expect(copied).toEqual(clean);
    expect(clean.apiKeyFingerprint).toHaveLength(16);
    expect(clean.apiSecretFingerprint).toHaveLength(16);
    expect(JSON.stringify(clean)).not.toContain("ABCD1234");
    expect(JSON.stringify(clean)).not.toContain(officialSecret);
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
