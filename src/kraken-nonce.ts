/**
 * Cálculo puro del siguiente nonce de Kraken: microsegundos desde epoch o el
 * anterior + 1 si el reloj no ha avanzado. Debe existir una única autoridad
 * persistente por clave de API (ver docs/kraken-api-safety.md); esta función
 * es el núcleo compartido que usan todos los llamantes de esa autoridad.
 */
export function computeNextNonce(lastNonce: bigint, now: number): bigint {
  const timeBased = BigInt(now) * 1000n;
  return timeBased > lastNonce ? timeBased : lastNonce + 1n;
}
