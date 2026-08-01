import { forwardDemoDashboard } from "./demo-dashboard-forward";

export function demoDashboard(): Promise<Response> {
  return forwardDemoDashboard();
}
