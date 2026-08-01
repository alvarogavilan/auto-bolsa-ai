import { labelledDemoDashboard } from "./demo-dashboard-labels";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_AUDIT_MARKER_MISSING:${search.slice(0, 64)}`);
  }
  return source.replace(search, replacement);
}

/**
 * Superpone una vista operativa normalizada a 50 EUR sobre el laboratorio de
 * nueve carteras independientes y añade revisión post-operación determinista.
 * No cambia señales, riesgo, PAPER, LIVE ni envía órdenes.
 */
export async function auditedDemoDashboard(): Promise<Response> {
  const base = await labelledDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.capital-context{margin-top:10px;padding:11px;border:1px solid rgba(105,167,255,.35);border-radius:13px;background:rgba(105,167,255,.08);font-size:12px;line-height:1.55;color:var(--muted)}.audit-status{margin-top:12px;padding:13px;border-radius:14px;border:1px solid var(--line);background:rgba(4,17,31,.55)}.audit-status.bad{border-color:rgba(255,124,136,.45);background:rgba(255,124,136,.08)}.audit-status.ok{border-color:rgba(73,221,161,.4);background:rgba(73,221,161,.08)}.trade-review{grid-column:1/-1;padding:12px;border-radius:13px;background:rgba(105,167,255,.07);border:1px solid rgba(105,167,255,.25)}.trade-review h4{margin:0 0 8px}.trade-review p{margin:5px 0;font-size:12px;line-height:1.5;color:var(--muted)}.review-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px;margin-top:9px}.review-metrics .order-detail{background:rgba(10,28,48,.65)}@media(max-width:440px){.review-metrics{grid-template-columns:1fr}}</style>`,
  );

  html = replaceRequired(
    html,
    '<div id="executiveGrid" class="portfolio-grid"></div>',
    '<div id="executiveGrid" class="portfolio-grid"></div><div id="capitalContext" class="capital-context">Calculando la equivalencia con una futura cuenta operativa de 50 €…</div><div id="tradeAuditStatus" class="audit-status">Analizando la calidad de las operaciones cerradas…</div>',
  );

  html = replaceRequired(
    html,
    "</body>",
    `<script>
(function(){
  const TARGET_CAPITAL_EUR=50;
  function safeNumber(value){const number=Number(value);return Number.isFinite(number)?number:0}
  function laneLabel(lane){return lane==='fast'?'Rápida':lane==='intraday'?'Intradía':lane==='swing'?'Swing':String(lane||'—')}
  function allStrategies(data){return Array.isArray(data&&data.state&&data.state.strategies)?data.state.strategies:[]}
  function closestEntry(strategy,sell){
    const trades=Array.isArray(strategy&&strategy.trades)?strategy.trades:[];
    return trades.filter(function(trade){return trade.side==='buy'&&safeNumber(trade.timestamp)<safeNumber(sell.timestamp)}).sort(function(a,b){return safeNumber(b.timestamp)-safeNumber(a.timestamp)})[0]||null;
  }
  function analyseClosedTrade(strategy,sell){
    const entry=closestEntry(strategy,sell);
    const pnl=safeNumber(sell.pnlEur);
    if(!entry){return {pnl:pnl,gross:0,costs:safeNumber(sell.feeEur),movePct:0,kind:'unknown',title:'Revisión incompleta',diagnosis:'No se conserva una compra emparejable para reconstruir todo el ciclo.',prevention:'No usar esta operación para cambiar parámetros hasta recuperar el ciclo completo.'}}
    const quantity=safeNumber(sell.quantity)||safeNumber(entry.quantity);
    const entryPrice=safeNumber(entry.price),exitPrice=safeNumber(sell.price);
    const gross=(exitPrice-entryPrice)*quantity;
    const costs=safeNumber(entry.feeEur)+safeNumber(sell.feeEur);
    const movePct=entryPrice?((exitPrice-entryPrice)/entryPrice):0;
    const reason=String(sell.reason||'');
    if(pnl>=0){return {pnl:pnl,gross:gross,costs:costs,movePct:movePct,kind:'positive',title:'Cierre rentable',diagnosis:'El movimiento neto cubrió los costes estimados de entrada y salida.',prevention:'Conservar como evidencia positiva; no implica que la estrategia sea apta por sí sola.'}}
    if(gross>0){return {pnl:pnl,gross:gross,costs:costs,movePct:movePct,kind:'cost',title:'Pérdida dominada por costes',diagnosis:'El precio avanzó a favor, pero el movimiento fue menor que comisiones y deslizamiento acumulados.',prevention:reason.includes('RSI')?'Patrón a bloquear para una futura cuenta real: una salida RSI discrecional no debe considerarse favorable si el beneficio bruto no cubre el coste completo de ida y vuelta.':'Exigir ventaja neta estimada superior al coste completo antes de considerar esta señal apta para dinero real.'}}
    const riskExit=reason.includes('Stop loss')||reason.includes('Tiempo máximo')||reason.includes('bajista');
    return {pnl:pnl,gross:gross,costs:costs,movePct:movePct,kind:'market',title:riskExit?'Pérdida de mercado con salida defensiva':'Entrada sin continuación',diagnosis:riskExit?'El precio se movió contra la posición y la regla de salida limitó la exposición.':'La señal de entrada no obtuvo continuación suficiente y terminó por debajo del precio de entrada.',prevention:'No modificar la estrategia por una sola operación. Acumular el patrón por mercado, carril y motivo; si se repite, endurecer el filtro de entrada antes de cualquier piloto real.'}
  }
  function aggregate(strategies){
    return strategies.reduce(function(acc,strategy){
      const perf=strategy.performance||{},position=strategy.position||null,cash=safeNumber(strategy.cashEur),equity=Number.isFinite(Number(strategy.equityEur))?Number(strategy.equityEur):cash;
      acc.initial+=safeNumber(strategy.initialCashEur);acc.cash+=cash;acc.equity+=equity;acc.realized+=safeNumber(perf.netPnlEur);acc.fees+=safeNumber(perf.totalFeesEur);acc.buys+=safeNumber(perf.buys);acc.sells+=safeNumber(perf.sells);acc.closed+=safeNumber(perf.closedTrades);acc.wins+=safeNumber(perf.winningTrades);acc.losses+=safeNumber(perf.losingTrades);
      if(position){acc.open+=1;acc.invested+=safeNumber(position.costEur);acc.positionValue+=Math.max(0,equity-cash)}
      return acc;
    },{initial:0,cash:0,equity:0,realized:0,fees:0,buys:0,sells:0,closed:0,wins:0,losses:0,open:0,invested:0,positionValue:0});
  }
  function renderNormalizedPortfolio(strategies){
    const totals=aggregate(strategies),scale=totals.initial>0?TARGET_CAPITAL_EUR/totals.initial:1;
    const equity=totals.equity*scale,cash=totals.cash*scale,invested=totals.invested*scale,realized=totals.realized*scale,unrealized=(totals.positionValue-totals.invested)*scale,totalPnl=equity-TARGET_CAPITAL_EUR,totalPct=TARGET_CAPITAL_EUR?totalPnl/TARGET_CAPITAL_EUR:0,fees=totals.fees*scale;
    const grid=document.getElementById('executiveGrid');
    if(grid){grid.innerHTML=[['Valor equivalente de cuenta',money(equity),pnlClass(totalPnl)],['Saldo equivalente disponible',money(cash),''],['Capital equivalente invertido',money(invested),totals.open?'positive':''],['PnL realizado equivalente',money(realized),pnlClass(realized)],['PnL no realizado equivalente',money(unrealized),pnlClass(unrealized)],['PnL total equivalente',money(totalPnl)+' · '+pct(totalPct),pnlClass(totalPnl)],['Órdenes observadas',totals.buys+' compras · '+totals.sells+' ventas',''],['Cerradas · G/P',totals.closed+' · '+totals.wins+'/'+totals.losses,''],['Comisiones equivalentes',money(fees),'']].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong class="'+item[2]+'">'+item[1]+'</strong></div>'}).join('')}
    const context=document.getElementById('capitalContext');
    if(context){context.innerHTML='<strong>Por qué antes aparecían '+money(totals.equity)+':</strong> el laboratorio mantiene '+strategies.length+' simulaciones independientes de '+money(strategies.length?totals.initial/strategies.length:0)+' cada una ('+money(totals.initial)+' técnicos en total). Esos saldos son comparables, no sumables como una cuenta real. La cifra principal queda ahora normalizada a una única cuenta de '+money(TARGET_CAPITAL_EUR)+'.'}
  }
  function renderAudit(strategies){
    const closed=[];
    strategies.forEach(function(strategy){(Array.isArray(strategy.trades)?strategy.trades:[]).filter(function(trade){return trade.side==='sell'}).forEach(function(sell){closed.push({strategy:strategy,sell:sell,review:analyseClosedTrade(strategy,sell)})})});
    closed.sort(function(a,b){return safeNumber(b.sell.timestamp)-safeNumber(a.sell.timestamp)});
    const costLosses=closed.filter(function(item){return item.review.kind==='cost'}).length,positive=closed.filter(function(item){return item.review.pnl>0}).length,totalPnl=closed.reduce(function(sum,item){return sum+item.review.pnl},0);
    const status=document.getElementById('tradeAuditStatus');
    if(status){const apt=closed.length>=30&&totalPnl>0&&positive>0&&costLosses/Math.max(1,closed.length)<0.2;status.className='audit-status '+(apt?'ok':'bad');status.innerHTML='<strong>'+(apt?'EVIDENCIA PRELIMINAR POSITIVA':'NO APTO PARA DINERO REAL')+'</strong><div style="font-size:12px;line-height:1.55;margin-top:5px">Cierres: '+closed.length+' · Ganadores: '+positive+' · Pérdidas dominadas por costes: '+costLosses+' · PnL técnico: '+money(totalPnl)+'. '+(apt?'Todavía requiere revisión humana y pruebas de ejecución.':'No se debe activar LIVE: la evidencia actual no demuestra ventaja neta después de costes.')+'</div>'}
    const list=document.getElementById('executiveTrades');if(!list)return;
    const cards=list.querySelectorAll('details.order-card');
    cards.forEach(function(card,index){const item=closed[index];if(!item||card.querySelector('.trade-review'))return;const review=item.review;const details=card.querySelector('.order-details');if(!details)return;const box=document.createElement('div');box.className='trade-review';box.innerHTML='<h4>'+escapeHtml(review.title)+'</h4><p><strong>Diagnóstico:</strong> '+escapeHtml(review.diagnosis)+'</p><p><strong>Medida preventiva:</strong> '+escapeHtml(review.prevention)+'</p><div class="review-metrics">'+[['Movimiento del precio',pct(review.movePct),pnlClass(review.gross)],['Resultado bruto',money(review.gross),pnlClass(review.gross)],['Costes ida/vuelta',money(review.costs),'negative'],['Resultado neto',money(review.pnl),pnlClass(review.pnl)]].map(function(metric){return '<div class="order-detail"><span>'+escapeHtml(metric[0])+'</span><strong class="'+metric[2]+'">'+metric[1]+'</strong></div>'}).join('')+'</div>';details.appendChild(box)});
  }
  let loading=false;
  async function refreshAudit(){if(loading)return;loading=true;try{const response=await fetch('/api/lab',{cache:'no-store'});if(!response.ok)throw new Error('lab unavailable');const data=await response.json();const strategies=allStrategies(data);renderNormalizedPortfolio(strategies);setTimeout(function(){renderAudit(strategies)},50)}catch(error){const status=document.getElementById('tradeAuditStatus');if(status){status.className='audit-status bad';status.textContent='No se pudo auditar la cartera PAPER en este momento.'}}finally{loading=false}}
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',refreshAudit)}else{refreshAudit()}
  setInterval(refreshAudit,15000);
})();
</script></body>`,
  );

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
