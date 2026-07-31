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

function validNonNegativeInteger(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 18;
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
    orderMinBase: pair.ordermin,
    lotDecimals: pair.lotDecimals,
    priceDecimals: pair.pairDecimals,
  };
}

/** Obtiene AssetPairs por la API pública y devuelve un mapa listo para guardrails. */
export async function fetchLivePairMetadata(
  requestedPair: string,
): Promise<Readonly<Record<string, LivePairMetadata>>> {
  const metadata = resolveLivePairMetadata(await fetchTradableAssetPairs(), requestedPair);
  return { [requestedPair]: metadata };
}
