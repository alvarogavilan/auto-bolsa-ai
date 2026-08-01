import { evidenceDemoDashboard } from "./demo-dashboard-evidence";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_PERFORMANCE_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

/**
 * Añade visibilidad financiera al DEMO sin tocar el motor de decisión ni la
 * estrategia: todo lo que se muestra aquí ya se calcula y se sirve en
 * `/api/lab` (LabPerformance, shadowLiveDemo.executionGate), simplemente no
 * se leía todavía en ninguna capa anterior del panel.
 */
export async function performanceDemoDashboard(): Promise<Response> {
  const base = await evidenceDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.chart-card{padding:14px}.equity-svg{width:100%;height:160px;display:block}.chart-caption{display:flex;justify-content:space-between;gap:8px;font-size:12px;color:var(--muted);margin-top:9px;flex-wrap:wrap}.positions-columns{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-top:12px}@media(max-width:720px){.positions-columns{grid-template-columns:1fr}}</style>`,
  );

  html = replaceRequired(
    html,
    '  <div class="section-title">Historial de operaciones</div>',
    `  <div class="section-title">Curva de capital</div>
  <section class="card chart-card">
    <div class="between"><div><h2 style="margin:0">Evolución del capital</h2><div class="muted" style="font-size:12px;margin-top:5px">Reconstruida a partir de las operaciones registradas (hasta 100 más recientes) de la estrategia destacada.</div></div></div>
    <div id="capitalCurveChart" style="margin-top:12px">Cargando…</div>
    <div id="capitalCurveCaption" class="chart-caption"></div>
  </section>

  <div class="section-title">Resultado bruto y neto</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Operaciones cerradas de la estrategia destacada</h2><div class="muted" style="font-size:12px;margin-top:5px">Bruto añade de nuevo las comisiones al resultado neto para mostrar el coste real de operar.</div></div></div>
    <div id="performanceSummary" class="grid" style="margin-top:12px;grid-template-columns:repeat(3,1fr)"></div>
  </section>

  <div class="section-title">Posiciones abiertas y cerradas</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Todas las estrategias del laboratorio</h2><div class="muted" style="font-size:12px;margin-top:5px">Vista conjunta, no solo la estrategia destacada.</div></div></div>
    <div class="grid" style="grid-template-columns:repeat(2,1fr);margin-top:12px">
      <div class="metric"><div class="label">Posiciones abiertas ahora</div><div id="positionsOpenCount" class="value">—</div></div>
      <div class="metric"><div class="label">Operaciones cerradas (total)</div><div id="positionsClosedCount" class="value">—</div></div>
    </div>
    <div id="positionsOpenList" class="strategies" style="margin-top:12px"></div>
  </section>

  <div class="section-title">Coste de ejecución estimado</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Slippage y coste de ida y vuelta</h2><div class="muted" style="font-size:12px;margin-top:5px">Verificación previa a una entrada real de libro de órdenes, no el resultado de una operación ya cerrada.</div></div></div>
    <div id="slippageGate" class="grid" style="margin-top:12px;grid-template-columns:repeat(3,1fr)"></div>
    <p id="slippageBlocker" class="muted" style="font-size:12px;margin:10px 0 0"></p>
  </section>

  <div class="section-title">Historial de operaciones</div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function fullSelectedStrategy(lab,demo){
    const strategies=Array.isArray(lab&&lab.state&&lab.state.strategies)?lab.state.strategies:[];
    const id=demo&&demo.selectedStrategy?demo.selectedStrategy.id:null;
    return strategies.find(function(s){return s.id===id})||strategies[0]||null;
  }
  function buildEquityCurve(strategy){
    const trades=Array.isArray(strategy.trades)?[...strategy.trades].sort(function(a,b){return Number(a.timestamp)-Number(b.timestamp)}):[];
    const initial=Number(strategy.initialCashEur);
    const start=Number.isFinite(initial)?initial:50;
    let cash=start,qty=0;
    const points=[{t:trades.length?trades[0].timestamp:Date.now(),equity:start}];
    trades.forEach(function(trade){
      const grossEur=Number(trade.grossEur)||0;const feeEur=Number(trade.feeEur)||0;const quantity=Number(trade.quantity)||0;const price=Number(trade.price)||0;
      if(trade.side==='buy'){cash-=(grossEur+feeEur);qty+=quantity}else{cash+=(grossEur-feeEur);qty=0}
      points.push({t:Number(trade.timestamp),equity:cash+qty*price});
    });
    const current=Number(strategy.equityEur);
    points.push({t:Date.now(),equity:Number.isFinite(current)?current:cash});
    return points;
  }
  function renderCapitalCurve(lab,demo){
    const strategy=fullSelectedStrategy(lab,demo);
    const wrap=document.getElementById('capitalCurveChart');const caption=document.getElementById('capitalCurveCaption');
    if(!strategy){wrap.innerHTML='<div class="empty-state">Esperando la primera estrategia con historial.</div>';caption.textContent='';return}
    const points=buildEquityCurve(strategy);
    if(points.length<2){wrap.innerHTML='<div class="empty-state">Todavía no hay suficientes puntos para trazar la curva.</div>';caption.textContent='';return}
    const values=points.map(function(p){return p.equity});
    const min=Math.min.apply(null,values);const max=Math.max.apply(null,values);const span=(max-min)||1;
    const w=560,h=160,pad=8;
    const coords=points.map(function(p,i){
      const x=pad+(i/(points.length-1))*(w-2*pad);
      const y=pad+(1-((p.equity-min)/span))*(h-2*pad);
      return x.toFixed(1)+','+y.toFixed(1);
    }).join(' ');
    const first=values[0];const last=values[values.length-1];
    const stroke=last>=first?'#49dda1':'#ff7c88';
    wrap.innerHTML='<svg viewBox="0 0 '+w+' '+h+'" preserveAspectRatio="none" class="equity-svg" role="img" aria-label="Curva de capital"><polyline points="'+coords+'" fill="none" stroke="'+stroke+'" stroke-width="2.5"/></svg>';
    caption.innerHTML='<span>Mínimo '+money(min)+'</span><span>Máximo '+money(max)+'</span><span class="'+pnlClass(last-first)+'">Variación '+money(last-first)+'</span>';
  }
  function renderPerformanceSummary(lab,demo){
    const strategy=fullSelectedStrategy(lab,demo);
    const wrap=document.getElementById('performanceSummary');
    if(!strategy||!strategy.performance){wrap.innerHTML='<div class="empty-state">Sin operaciones cerradas todavía.</div>';return}
    const perf=strategy.performance;
    const net=Number(perf.netPnlEur)||0;const fees=Number(perf.totalFeesEur)||0;const gross=net+fees;
    const grossProfit=Number(perf.grossProfitEur)||0;const grossLoss=Number(perf.grossLossEur)||0;
    wrap.innerHTML=[
      ['PnL neto (con comisiones)',money(net),pnlClass(net)],
      ['PnL bruto (sin comisiones)',money(gross),pnlClass(gross)],
      ['Comisiones totales pagadas',money(fees),''],
      ['Operaciones cerradas',String(perf.closedTrades||0),''],
      ['Ganadoras / perdedoras',(perf.winningTrades||0)+' / '+(perf.losingTrades||0),''],
      ['Ganancia bruta acumulada',money(grossProfit),'positive'],
      ['Pérdida bruta acumulada',money(-grossLoss),'negative']
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong class="'+item[2]+'">'+item[1]+'</strong></div>'}).join('');
  }
  function renderPositionsOverview(lab){
    const strategies=Array.isArray(lab&&lab.state&&lab.state.strategies)?lab.state.strategies:[];
    const open=strategies.filter(function(s){return s.position!==null});
    const closedCount=strategies.reduce(function(sum,s){return sum+Number(s.performance&&s.performance.closedTrades||0)},0);
    document.getElementById('positionsOpenCount').textContent=String(open.length);
    document.getElementById('positionsClosedCount').textContent=String(closedCount);
    const wrap=document.getElementById('positionsOpenList');
    wrap.innerHTML=open.length?open.map(function(s){
      const p=s.position;const current=Number(s.currentReferencePrice);
      const estimated=Number.isFinite(current)?(current-Number(p.entryPrice))*Number(p.quantity):null;
      return '<div class="strategy"><div class="between"><div class="name">'+escapeHtml(humanMarket(s.symbol))+'</div><span class="badge">'+lane(s.lane)+'</span></div><div class="numbers"><span>Entrada '+money(p.entryPrice)+'</span><strong class="'+pnlClass(estimated)+'">'+money(estimated)+'</strong></div></div>';
    }).join(''):'<div class="empty-state">Ninguna posición abierta en este momento.</div>';
  }
  function renderExecutionQualityGate(demo){
    const gate=demo&&demo.executionGate?demo.executionGate:null;
    const wrap=document.getElementById('slippageGate');const blockerEl=document.getElementById('slippageBlocker');
    if(!gate){wrap.innerHTML='<div class="empty-state">Esta estrategia no exige verificación previa de ejecución (fuera de la vía rápida).</div>';blockerEl.textContent='';return}
    const costPct=gate.immediateRoundTripCostPct;
    wrap.innerHTML=[
      ['Verificación requerida',gate.required?'Sí':'No',''],
      ['Evidencia reciente',gate.fresh?'Sí':'No',''],
      ['Entrada permitida',gate.entryAllowed?'Sí':'No',gate.entryAllowed?'positive':'negative'],
      ['Coste ida y vuelta estimado',(costPct===null||costPct===undefined)?'—':pct(costPct),''],
      ['Evidencia disponible',gate.available?'Sí':'No','']
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong class="'+item[2]+'">'+item[1]+'</strong></div>'}).join('');
    blockerEl.textContent=gate.blocker?('Bloqueo activo: '+gate.blocker):'Sin bloqueo de ejecución activo para esta estrategia.';
  }
`,
  );

  html = replaceRequired(
    html,
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderPaperEvidence(lab);renderStress(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo);renderFrozenForward(lab)}",
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderPaperEvidence(lab);renderStress(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo);renderFrozenForward(lab);renderCapitalCurve(lab,demo);renderPerformanceSummary(lab,demo);renderPositionsOverview(lab);renderExecutionQualityGate(demo)}",
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
