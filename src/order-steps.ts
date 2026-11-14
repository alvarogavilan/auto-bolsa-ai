/**
 * Pasos de ejecución manual, escritos para la APP de Crypto.com (la que usa el
 * usuario), no para el Exchange: en la app se compra por importe en euros a un
 * precio que fija la propia app, sin órdenes límite. Por eso la única
 * comprobación de precio es «precio máximo»: si la app muestra más, no se compra.
 *
 * Los mismos pasos se usan en Telegram y en la pantalla «Orden ahora».
 */
export function coinLabel(market: "gold" | "crypto", asset: string): string {
  return market === "gold" ? "PAXG (PAX Gold)" : asset;
}

export function coinUnit(market: "gold" | "crypto", asset: string): string {
  return market === "gold" ? "PAXG" : asset;
}

function euros(value: number): string {
  return `${value.toFixed(2).replace(".", ",")} €`;
}

export function buySteps(input: { market: "gold" | "crypto"; asset: string; amountEur: number; maxPriceText: string }): string[] {
  const coin = coinLabel(input.market, input.asset);
  return [
    "Abre la app Crypto.com y pulsa el botón central «Operar» → «Comprar»",
    `Busca y elige ${coin}`,
    `Escribe el importe: ${euros(input.amountEur)} y paga con tu saldo en euros (EUR)`,
    `Antes de confirmar, mira el precio de 1 ${coinUnit(input.market, input.asset)}: debe ser ${input.maxPriceText} o menos. Si es mayor, cancela`,
    "Confirma la compra",
  ];
}

export function sellSteps(input: { market: "gold" | "crypto"; asset: string; alertId: string; quantityBase: number }): string[] {
  const unit = coinUnit(input.market, input.asset);
  return [
    "Abre la app Crypto.com y pulsa el botón central «Operar» → «Vender»",
    `Elige ${coinLabel(input.market, input.asset)}`,
    `Cantidad: TODO lo comprado con la alerta ${input.alertId} (≈ ${input.quantityBase.toFixed(8)} ${unit}) y recibe en euros (EUR)`,
    "Confirma la venta",
  ];
}
