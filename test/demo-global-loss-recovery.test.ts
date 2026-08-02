import { describe, expect, it } from "vitest";
import { demoDashboard } from "../src/demo-dashboard";

describe("DEMO global PAPER loss recovery", () => {
  it("shows the global losing streak and specific recovery veto counter", async () => {
    const html = await (await demoDashboard()).text();

    expect(html).toContain("GLOBAL_LOSS_RECOVERY_THRESHOLD = 3");
    expect(html).toContain("Freno global PAPER activo");
    expect(html).toContain("Racha actual:");
    expect(html).toContain("rejectedByLossRecovery");
    expect(html).toContain("vetos históricos por recuperación");
    expect(html).toContain("no se mezcla con exposición ni riesgo");
    expect(html).toContain("Las salidas de seguridad y la gestión de posiciones abiertas continúan activas");
  });

  it("keeps the feature observational and LIVE blocked", async () => {
    const html = await (await demoDashboard()).text();
    expect(html).toContain("LIVE permanece bloqueado");
    expect(html).not.toContain("LIVE_TRADING_ENABLED = true");
  });
});
