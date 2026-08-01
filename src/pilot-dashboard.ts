import { pilotDashboard as pilotDashboardCore } from "./pilot-dashboard-core";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) throw new Error(`PILOT_FEES_MARKER_MISSING:${search.slice(0, 48)}`);
  return source.replace(search, replacement);
}

export async function pilotDashboard(): Promise<Response> {
  const core = pilotDashboardCore();
  let html = await core.text();

  html = replaceRequired(
    html,
    '  <div class="section-title">Mercado seleccionado</div>',
    `  <div class="section-title">Comisiones efectivas Kraken</div>
  <section class="card">
    <div class="grid3">
      <div class="mini"><span>Maker efectivo</span><strong id="krakenMakerFee">—</strong></div>
      <div class="mini"><span>Taker efectivo</span><strong id="krakenTakerFee">—</strong></div>
      <div class="mini"><span>Supuesto PAPER por lado</span><strong id="krakenPaperFee">—</strong></div>
      <div class="mini"><span>Coste ida y vuelta sobre 5 €</span><strong id="krakenFiveEurFee">—</strong></div>
      <div class="mini"><span>Base del nivel</span><strong id="krakenTierBasis">—</strong></div>
      <div class="mini"><span>Par resuelto</span><strong id="krakenFeePair">—</strong></div>
    </div>
    <div id="krakenFeeMessage" class="status-message" style="margin-top:10px">Lectura pendiente.</div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">Consulta privada de solo lectura. No crea órdenes y no cambia automáticamente los parámetros de la cohorte PAPER congelada.</p>
  </section>

  <div class="section-title">Mercado seleccionado</div>`,
  );

  html = replaceRequired(
    html,
    "  function renderMarket(data){",
    `  function renderKrakenFees(kraken){
    const fees=kraken&&kraken.fees?kraken.fees:{};
    const feePct=function(value){return value===null||value===undefined?'No disponible':Number(value).toFixed(4).replace('.',',')+' %'};
    const feeMoney=function(value){return value===null||value===undefined?'No disponible':money(value)};
    document.getElementById('krakenMakerFee').textContent=feePct(fees.makerFeePercent);
    document.getElementById('krakenTakerFee').textContent=feePct(fees.takerFeePercent);
    document.getElementById('krakenPaperFee').textContent=feePct(fees.assumedPaperFeeEachSidePercent);
    document.getElementById('krakenFiveEurFee').textContent=feeMoney(fees.fiveEurTakerRoundTripFeeEur);
    document.getElementById('krakenTierBasis').textContent=fees.tierBasis===null||fees.tierBasis===undefined?'No disponible':number(fees.tierBasis)+' · '+(fees.tierBasisSource||'origen desconocido');
    document.getElementById('krakenFeePair').textContent=fees.pairResolved||fees.pairRequested||'No disponible';
    const message=document.getElementById('krakenFeeMessage');
    if(fees.available!==true){message.textContent=fees.error?'Tarifa no disponible: '+fees.error:'Tarifa efectiva no disponible en esta comprobación.';return}
    message.textContent=fees.paperFeeMatchesCurrentTaker===true?'El supuesto PAPER coincide con la tarifa taker efectiva.':'La tarifa efectiva difiere del supuesto PAPER. La cohorte congelada no se modifica automáticamente.';
  }

  function renderMarket(data){`,
  );

  html = replaceRequired(
    html,
    "    renderKraken(data.kraken);\n    renderMarket(data);",
    "    renderKraken(data.kraken);\n    renderKrakenFees(data.kraken);\n    renderMarket(data);",
  );

  const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1] ?? "";
  new Function(script);

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
