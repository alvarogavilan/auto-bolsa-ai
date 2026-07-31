import { describe, expect, it } from "vitest";
import { assessKrakenPermissions, signKrakenRequest } from "../src/kraken";

describe("Kraken API safety", () => {
  it("matches a deterministic Kraken REST signature", async () => {
    const signature = await signKrakenRequest(
      "/0/private/GetApiKeyInfo",
      "1234567890000",
      "nonce=1234567890000",
      "c2VjcmV0",
    );
    expect(signature).toBe(
      "QMEO/wGhhDeHf31mvi4gtHlnakwnVJVwRsVz1On92GAtvQwm06Kk71c4OHN+kkpOQ+bN5iHkV7G06XA1f9EskA==",
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
