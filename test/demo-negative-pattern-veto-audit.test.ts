import { describe, expect, it } from "vitest";
import { DEMO_GLOBAL_LOSS_RECOVERY_CODE } from "../src/demo-global-loss-recovery";

describe("DEMO negative PAPER pattern veto audit", () => {
  it("renders early and statistical pattern vetoes separately", () => {
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("rejectedByEarlyLossStreak");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("rejectedByNegativePattern");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("Vetos tempranos por 3 pérdidas consecutivas");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("vetos estadísticos por patrón negativo");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("al menos 5 cierres comparables");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("profit factor inferior a 1");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("No alteran cierres, stops, posiciones abiertas ni el historial");
  });

  it("keeps recovery, exposure and risk conceptually separated", () => {
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("no se mezcla con exposición ni riesgo");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("vetos tempranos de patrón");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("vetos estadísticos de patrón");
  });

  it("keeps LIVE blocked while exposing the filter evidence", () => {
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("LIVE permanece bloqueado");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("ciclos auditados");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("ledgerSchema");
  });
});
