import { fetchTradableAssetPairs, type KrakenAssetPair } from "./kraken-markets";
import type { LivePairMetadata } from "./live-guardrails";

function normalizedPairName(value: string): string {
  return value.toUpperCase().replaceAll("/", "").replaceAll("-", "").trim();
}

function aliases(pair: KrakenAssetPair): string[] {
  return [pair.key, pair.altname, pair.wsname ?? ""]
    .map(normalizedPairName)
    .filter((value) => value.length > 0);
}

function acceptedPairCodes(pair: KrakenAssetPair): string[] {
  const values = [pair.key, pair.altname, pair.wsname ?? ""];
  const expanded = values.flatMap((value) => {
    const trimmed = value.trim();
    if (!trimmed) return [];
    const normalized = normalizedPairName(trimmed);
    return normalized === trimmed ? [trimmed] : [trimmed, normalized];
  });
  return [...new Set(expanded)];
}

function validNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 18;
}

export interface LivePairResolution {
  requestedPair: string;
  canonicalPair: string;
  acceptedPairCodes: string[];
  metadata: LivePairMetadata;
}

/**
 * Resuelve un par y conserva todos los identificadores que Kraken puede usar
 * en órdenes y TradesHistory. Falla cerrado ante par desconocido, suspendido
 * o datos inválidos; nunca inventa aliases, mínimos o precisiones.
 */
export function resolveLivePairResolution(
  pairs: readonly KrakenAssetPair[],
  requestedPair: string,
): LivePairResolution {
  const normalized = normalizedPairName(requestedPair);
  const pair = pairs.find((candidate) => aliases(candidate).includes(normalized));

  if (!pair) throw new Error(`Kraken AssetPairs no contiene el par ${requestedPair}`);
  if (pair.status !== "online") {
    throw new Error(`El par ${requestedPair} no está operativo en Kraken (status=${pair.status})`);
  }
  if (!Number.isFinite(pair.ordermin) || pair.ordermin <= 0) {
    throw new Error(`Kraken devolvió ordermin inválido para ${requestedPair}`);
  }
  if (!validNonNegativeInteger(pair.lotDecimals)) {
    throw new Error(`Kraken devolvió lot_decimals inválido para ${requestedPair}`);
  }
  if (!validNonNegativeInteger(pair.pairDecimals)) {
    throw new Error(`Kraken devolvió pair_decimals inválido para ${requestedPair}`);
  }

  return {
    requestedPair,
    canonicalPair: pair.key,
    acceptedPairCodes: acceptedPairCodes(pair),
    metadata: {
      orderMinBase: pair.ordermin,
      lotDecimals: pair.lotDecimals,
      priceDecimals: pair.pairDecimals,
    },
  };
}

/**
 * Convierte la respuesta pública AssetPairs de Kraken en los metadatos exactos
 * que usan las puertas LIVE. Falla cerrado ante par desconocido, suspendido o
 * datos inválidos: nunca sustituye silenciosamente mínimos o precisiones por
 * valores escritos a mano.
 */
export function resolveLivePairMetadata(
  pairs: readonly KrakenAssetPair[],
  requestedPair: string,
): LivePairMetadata {
  return resolveLivePairResolution(pairs, requestedPair).metadata;
}

/** Obtiene AssetPairs y devuelve metadatos junto con aliases verificables. */
export async function fetchLivePairResolution(requestedPair: string): Promise<LivePairResolution> {
  return resolveLivePairResolution(await fetchTradableAssetPairs(), requestedPair);
}

/** Obtiene AssetPairs por la API pública y devuelve un mapa listo para guardrails. */
export async function fetchLivePairMetadata(
  requestedPair: string,
): Promise<Readonly<Record<string, LivePairMetadata>>> {
  const metadata = (await fetchLivePairResolution(requestedPair)).metadata;
  return { [requestedPair]: metadata };
}
