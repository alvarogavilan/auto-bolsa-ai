import { describe, expect, it } from "vitest";
import { appInstallResponse } from "../src/app-install";
import { emptyRadarTrack, evaluateRadarTrack, recordRadarSnapshot, type RadarSnapshot } from "../src/radar-track-record";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 1);

function snap(hour: number, tone: number, priceEur: number, mentions = 10): RadarSnapshot {
  return { at: T0 + hour * HOUR, topics: { gold: { tone, mentions, priceEur } } };
}

describe("radar track record", () => {
  it("rejects snapshots that are too close together or empty", () => {
    const state = emptyRadarTrack();
    expect(recordRadarSnapshot(state, snap(0, 20, 3500))).toBe(true);
    expect(recordRadarSnapshot(state, { ...snap(0, 20, 3500), at: T0 + 10 * 60_000 })).toBe(false);
    expect(recordRadarSnapshot(state, { at: T0 + 2 * HOUR, topics: {} })).toBe(false);
    expect(recordRadarSnapshot(state, snap(1, 20, 3500))).toBe(true);
    expect(state.snapshots).toHaveLength(2);
  });

  it("refuses to give a verdict without enough verified signals", () => {
    const state = emptyRadarTrack();
    for (let hour = 0; hour < 10; hour += 1) recordRadarSnapshot(state, snap(hour, 30, 3500 + hour));
    const gold4h = evaluateRadarTrack(state, T0 + 10 * HOUR).results.find((result) => result.topic === "gold" && result.horizonHours === 4);
    expect(gold4h?.signals).toBe(6);
    expect(gold4h?.verdict).toBe("Sin muestra suficiente");
  });

  it("measures hits against the real later price", () => {
    const rising = emptyRadarTrack();
    for (let hour = 0; hour < 60; hour += 1) recordRadarSnapshot(rising, snap(hour, 30, 3500 + hour));
    const good = evaluateRadarTrack(rising, T0 + 60 * HOUR).results.find((result) => result.topic === "gold" && result.horizonHours === 4);
    expect(good?.hitRatePct).toBe(100);
    expect(good?.verdict).toBe("Acierta más que el azar");

    const wrong = emptyRadarTrack();
    for (let hour = 0; hour < 60; hour += 1) recordRadarSnapshot(wrong, snap(hour, 30, 3500 - hour));
    const bad = evaluateRadarTrack(wrong, T0 + 60 * HOUR).results.find((result) => result.topic === "gold" && result.horizonHours === 4);
    expect(bad?.hitRatePct).toBe(0);
    expect(bad?.verdict).toBe("Suele fallar");
  });

  it("ignores neutral tone, thin mentions and gaps in the data", () => {
    const state = emptyRadarTrack();
    recordRadarSnapshot(state, snap(0, 5, 3500));
    recordRadarSnapshot(state, snap(1, 40, 3500, 1));
    recordRadarSnapshot(state, snap(2, 40, 3500));
    recordRadarSnapshot(state, snap(40, 40, 3600));
    const report = evaluateRadarTrack(state, T0 + 41 * HOUR);
    expect(report.results.every((result) => result.signals === 0)).toBe(true);
    expect(report.mayInfluenceOrders).toBe(false);
  });
});

describe("app install", () => {
  it("serves a manifest and PNG icons", async () => {
    const manifest = await appInstallResponse("/manifest.webmanifest")?.json<{ display: string; start_url: string }>();
    expect(manifest?.display).toBe("standalone");
    expect(manifest?.start_url).toBe("/");
    const icon = new Uint8Array(await appInstallResponse("/icon-180.png")!.arrayBuffer());
    expect([...icon.slice(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(appInstallResponse("/other")).toBeNull();
  });
});
