import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("../src/demo-dashboard.ts", import.meta.url), "utf8");
const panel = readFileSync(new URL("../src/demo-xau-position.ts", import.meta.url), "utf8");

describe("XAU PAPER visible demo integration", () => {
  it("injects the XAU panel into the public demo", () => {
    expect(dashboard).toContain("DEMO_XAU_POSITION_STYLE");
    expect(dashboard).toContain("DEMO_XAU_POSITION_CODE");
    expect(dashboard).toContain("${DEMO_XAU_POSITION_CODE}</body>");
  });

  it("reads the persisted XAU position endpoint without enabling LIVE", () => {
    expect(panel).toContain("fetch('/api/xau/status'");
    expect(panel).toContain("status && status.positionBook");
    expect(panel).toContain("LIVE y órdenes reales desactivados");
  });
});
