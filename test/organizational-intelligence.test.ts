import { describe, expect, it } from "vitest";
import { buildOrganizationalIntelligence } from "../src/organizational-intelligence";

describe("organizational intelligence", () => {
  it("declares every requested department without claiming unsupported excellence", () => {
    const report = buildOrganizationalIntelligence(123);
    const ids = report.departmentExcellence.departments.map((department) => department.id);

    expect(report.schemaVersion).toBe("auto-bolsa-organization-v2");
    expect(report.departmentExcellence.total).toBe(16);
    expect(report.departmentExcellence.allDepartmentsDeclared).toBe(true);
    expect(report.departmentExcellence.excellenceClaimedWithoutEvidence).toBe(false);
    expect(ids).toEqual(expect.arrayContaining([
      "direccion-general",
      "comite-decision",
      "noticias-mundiales",
      "interpretacion-graficas",
      "macroeconomia",
      "tesoreria",
      "riesgo",
      "comparativas",
      "ia-predictiva",
      "aprendizaje",
      "auditoria",
      "validacion-cientifica",
      "deteccion-patrones",
      "estadistica",
      "ejecucion",
      "significancia-economica",
    ]));
  });

  it("keeps live authority disabled in every department", () => {
    const report = buildOrganizationalIntelligence();

    expect(report.liveTrading).toBe(false);
    expect(report.eligibleForLiveReview).toBe(false);
    expect(report.trainingPolicy.noAutonomousLiveAuthority).toBe(true);
    expect(report.departmentExcellence.departments.every((department) => department.mayTradeLive === false)).toBe(true);
    expect(report.departmentExcellence.departments.every((department) => department.evidenceGate.length > 0)).toBe(true);
  });
});
