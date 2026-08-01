import { auditedDemoDashboard } from "./demo-dashboard-audit";

export function demoDashboard(): Promise<Response> {
  return auditedDemoDashboard();
}
