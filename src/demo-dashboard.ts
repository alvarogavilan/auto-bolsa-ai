import { standaloneDemoDashboard } from "./demo-dashboard-standalone";

export function demoDashboard(): Response {
  const response = standaloneDemoDashboard();
  response.headers.set("Cache-Control", "no-store");
  return response;
}
