import { healthDemoDashboard } from "./demo-dashboard-health";

export function demoDashboard(): Promise<Response> {
  return healthDemoDashboard();
}
