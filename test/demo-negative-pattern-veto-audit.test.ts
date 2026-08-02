import { describe, expect, it } from "vitest";
import { DEMO_GLOBAL_LOSS_RECOVERY_CODE } from "../src/demo-global-loss-recovery";

describe("DEMO negative PAPER pattern veto audit", () => {
  it("renders the persistent veto counter separately from recovery, exposure and risk", () => {
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("rejectedByNegativePattern");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("Vetos por patrón negativo");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("al menos 5 cierres comparables");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("profit factor inferior a 1");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("No altera cierres, stops, posiciones abiertas ni el historial");
  });

  it("keeps LIVE blocked while exposing the filter evidence", () => {
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("LIVE permanece bloqueado");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("ciclos auditados");
    expect(DEMO_GLOBAL_LOSS_RECOVERY_CODE).toContain("ledgerSchema");
  });
});
