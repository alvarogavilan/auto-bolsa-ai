import { standaloneDemoDashboard } from "./demo-dashboard-standalone";

// La ruta pública conserva un contrato no-store y una única implementación PAPER.
export function demoDashboard(): Response {
  const response = standaloneDemoDashboard();
  response.headers.set("Cache-Control", "no-store");
  return response;
}
