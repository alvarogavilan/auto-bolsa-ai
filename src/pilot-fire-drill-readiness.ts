import { runPilotFireDrill } from "./pilot-fire-drill";

export async function enrichReadinessWithFireDrill(response: Response): Promise<Response> {
  if (!response.ok) return response;

  let body: Record<string, unknown>;
  try {
    const value = await response.clone().json();
    if (!value || typeof value !== "object" || Array.isArray(value)) return response;
    body = value as Record<string, unknown>;
  } catch {
    return response;
  }

  const fireDrill = await runPilotFireDrill();
  const blockers = Array.isArray(body.blockers)
    ? body.blockers.filter((item): item is string => typeof item === "string")
    : [];
  const passedChecks = Array.isArray(body.passedChecks)
    ? body.passedChecks.filter((item): item is string => typeof item === "string")
    : [];

  if (fireDrill.passed) {
    passedChecks.push(`Simulacro integral superado: ${fireDrill.passedChecks}/${fireDrill.totalChecks}`);
  } else {
    blockers.push(`Simulacro integral incompleto: ${fireDrill.passedChecks}/${fireDrill.totalChecks}`);
  }

  const originalEligible = body.infrastructureEligibleForManualReview === true;
  const eligible = originalEligible && fireDrill.passed;
  return Response.json({
    ...body,
    fireDrill,
    blockers,
    passedChecks,
    infrastructureEligibleForManualReview: eligible,
    message: eligible
      ? "Infraestructura elegible para revisión humana. El envío real continúa sin ruta y sin activación."
      : `Piloto todavía bloqueado por ${blockers.length} condición(es).`,
    liveTrading: false,
  }, {
    status: response.status,
    headers: { "Cache-Control": "no-store" },
  });
}
