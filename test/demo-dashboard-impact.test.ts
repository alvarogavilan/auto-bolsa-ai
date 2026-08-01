import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("committee impact in DEMO dashboard", () => {
  it("shows causal committee metrics without enabling authority", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("Impacto medido del comité");
    expect(html).toContain("¿Habrían servido sus vetos?");
    expect(html).toContain("Pérdidas evitables");
    expect(html).toContain("Ganancias rechazadas");
    expect(html).toContain("Balance hipotético");
    expect(html).toContain("Autoridad: desactivada");
    expect(html).toContain("renderCommitteeImpact");
    expect(html).toContain("committeeImpact:lab.committeeImpact");
  });

  it("states that the committee remains shadow even with enough evidence", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("La autoridad automática sigue desactivada");
    expect(html).not.toContain("committeeAuthorityRecommended=true");
    expect(html).not.toContain("LIVE_TRADING_ENABLED=true");
    expect(html).not.toContain("/api/pilot/submit");
  });
});
