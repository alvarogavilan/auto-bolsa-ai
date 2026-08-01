export interface PilotOneShotManifest {
  schemaVersion: "pilot-one-shot-manifest-v1";
  manifestId: string;
  payloadHashSha256: string;
  generatedAt: number;
  expiresAt: number;
  eligibleForHumanArming: boolean;
  blockers: string[];
  order: {
    clOrdId: string;
    pair: string;
    side: "buy" | "sell";
    volumeBase: number;
    limitPrice: number;
    notionalEur: number;
  } | null;
  economics: {
    eurBalance: number | null;
    takerFeePercent: number | null;
    estimatedRoundTripFeeEur: number | null;
    minimumReservedEur: number | null;
    reserveSatisfied: boolean;
  };
  evidence: {
    readinessGeneratedAt: number | null;
    fireDrillPassed: boolean;
    fireDrillChecks: string;
    accountClean: boolean;
    accountCheckedAt: number | null;
    certificateStatus: string;
    certificateId: string | null;
    certificateExpiresAt: number | null;
  };
  singleOrderOnly: true;
  requiresManualHumanAction: true;
  authorizationToken: null;
  persisted: false;
  submitCapable: false;
  realOrderCreated: false;
  liveTrading: false;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stable(object[key])}`).join(",")}}`;
}

async function sha256Hex(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(stable(value));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function buildPilotOneShotManifest(
  readinessValue: unknown,
  connectionValue: unknown,
  now = Date.now(),
): Promise<PilotOneShotManifest> {
  const readiness = record(readinessValue);
  const connection = record(connectionValue);
  const executor = record(readiness.executor);
  const rawOrder = record(executor.order);
  const account = record(readiness.accountCleanliness);
  const fireDrill = record(readiness.fireDrill);
  const certificate = record(readiness.preflightCertificate);
  const effectiveFees = record(connection.effectiveFees);
  const taker = record(effectiveFees.taker);

  const clOrdId = text(rawOrder.clOrdId);
  const pair = text(rawOrder.pair);
  const sideRaw = text(rawOrder.side);
  const side = sideRaw === "buy" || sideRaw === "sell" ? sideRaw : null;
  const volumeBase = finite(rawOrder.volumeBase);
  const limitPrice = finite(rawOrder.limitPrice);
  const notionalEur = finite(rawOrder.notionalEur);
  const order = clOrdId && pair && side && volumeBase !== null && limitPrice !== null && notionalEur !== null
    ? { clOrdId, pair, side, volumeBase, limitPrice, notionalEur }
    : null;

  const eurBalance = finite(account.eurBalance) ?? finite(record(readiness.kraken).connection && record(record(readiness.kraken).connection).eurBalance);
  const takerFeePercent = finite(taker.percent);
  const takerRate = takerFeePercent === null ? null : takerFeePercent / 100;
  const estimatedRoundTripFeeEur = order && takerRate !== null
    ? order.notionalEur * takerRate * 2
    : null;
  const minimumReservedEur = order && estimatedRoundTripFeeEur !== null
    ? order.notionalEur + estimatedRoundTripFeeEur + 0.05
    : null;
  const reserveSatisfied = eurBalance !== null
    && minimumReservedEur !== null
    && eurBalance >= minimumReservedEur;

  const certificateStatus = text(certificate.status) ?? "absent";
  const certificateId = text(certificate.certificateId);
  const certificateExpiresAt = finite(certificate.expiresAt);
  const firePassed = fireDrill.passed === true;
  const fireChecks = `${finite(fireDrill.passedChecks) ?? 0}/${finite(fireDrill.totalChecks) ?? 0}`;
  const accountClean = account.accountCleanForBaseline === true;
  const blockers: string[] = [];

  if (readiness.infrastructureEligibleForManualReview !== true) {
    blockers.push("El expediente base todavía no es elegible para revisión humana");
  }
  if (!firePassed) blockers.push("El simulacro integral no está superado");
  if (!accountClean) blockers.push("La cuenta Kraken no está confirmada como limpia");
  if (!order) blockers.push("No existe una orden preparada completa");
  if (order && (order.notionalEur <= 0 || order.notionalEur > 5)) {
    blockers.push("La orden no respeta el máximo absoluto de 5 EUR");
  }
  if (certificateStatus !== "valid") blockers.push("El certificado validate=true no está vigente");
  if (certificateExpiresAt !== null && certificateExpiresAt <= now) blockers.push("El certificado validate=true ha caducado");
  if (takerFeePercent === null) blockers.push("La tarifa taker efectiva no está confirmada");
  if (!reserveSatisfied) blockers.push("El saldo EUR no conserva la reserva mínima para costes y salida");
  if (readiness.submissionEndpointAvailable !== false) blockers.push("La ruta de envío no consta como bloqueada");
  if (readiness.submissionArmed !== false) blockers.push("El envío aparece armado antes de la autorización humana");
  if (readiness.liveTrading !== false) blockers.push("LIVE no consta como apagado");

  const payload = {
    readinessGeneratedAt: finite(readiness.generatedAt),
    maximumOrderNotionalEur: finite(readiness.maximumOrderNotionalEur),
    order,
    certificate: {
      status: certificateStatus,
      certificateId,
      expiresAt: certificateExpiresAt,
    },
    account: {
      checkedAt: finite(account.checkedAt),
      clean: accountClean,
      nonEurAssetCount: finite(account.nonEurAssetCount),
      openOrderCount: finite(account.openOrderCount),
    },
    fireDrill: {
      generatedAt: finite(fireDrill.generatedAt),
      passed: firePassed,
      checks: fireChecks,
    },
    economics: {
      eurBalance,
      takerFeePercent,
      estimatedRoundTripFeeEur,
      minimumReservedEur,
    },
  };
  const payloadHashSha256 = await sha256Hex(payload);
  const defaultExpiry = now + 2 * 60_000;
  const expiresAt = certificateExpiresAt === null
    ? defaultExpiry
    : Math.min(defaultExpiry, certificateExpiresAt);

  return {
    schemaVersion: "pilot-one-shot-manifest-v1",
    manifestId: payloadHashSha256.slice(0, 24),
    payloadHashSha256,
    generatedAt: now,
    expiresAt,
    eligibleForHumanArming: blockers.length === 0,
    blockers,
    order,
    economics: {
      eurBalance,
      takerFeePercent,
      estimatedRoundTripFeeEur,
      minimumReservedEur,
      reserveSatisfied,
    },
    evidence: {
      readinessGeneratedAt: finite(readiness.generatedAt),
      fireDrillPassed: firePassed,
      fireDrillChecks: fireChecks,
      accountClean,
      accountCheckedAt: finite(account.checkedAt),
      certificateStatus,
      certificateId,
      certificateExpiresAt,
    },
    singleOrderOnly: true,
    requiresManualHumanAction: true,
    authorizationToken: null,
    persisted: false,
    submitCapable: false,
    realOrderCreated: false,
    liveTrading: false,
  };
}
