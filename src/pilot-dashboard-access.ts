import { feesAwarePilotDashboard } from "./pilot-dashboard-fees";

export function authenticatedPilotDashboard(): Promise<Response> {
  return feesAwarePilotDashboard();
}
