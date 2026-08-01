import { timelineDemoDashboard } from "./demo-dashboard-timeline";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_HEALTH_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

/**
 * Añade una cabecera ejecutiva para entender inmediatamente qué ha comprado,
 * qué ha vendido y cuál es el resultado PAPER. Después conserva el indicador
 * técnico de salud del sistema. No añade llamadas ni modifica estrategia,
 * riesgo, PAPER o LIVE: únicamente reorganiza datos ya servidos.
 */
export async function healthDemoDashboard(): Promise<Response> {
  const base = await timelineDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.executive-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:12px}.executive-grid .mini strong{font-size:20px}.latest-trades{display:grid;gap:8px;margin-top:12px}.latest-trade{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:14px;background:rgba(4,17,31,.42)}.trade-side{min-width:68px;text-align:center}.trade-side.buy{background:rgba(73,221,161,.14);color:var(--green);border-color:rgba(73,221,161,.4)}.trade-side.sell{background:rgba(255,124,136,.14);color:var(--red);border-color:rgba(255,124,136,.4)}.trade-main strong,.trade-main span{display:block}.trade-main span,.trade-meta{font-size:12px;color:var(--muted)}.trade-meta{text-align:right}.health-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:12px}@media(max-width:720px){.executive-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:440px){.health-grid{grid-template-columns:1fr}.latest-trade{grid-template-columns:auto 1fr}.trade-meta{grid-column:2;text-align:left}}.health-verdict.ok{background:rgba(73,221,161,.14);color:var(--green);border-color:rgba(73,221,161,.4)}.health-verdict.warn{background:rgba(255,209,102,.14);color:var(--amber);border-color:rgba(255,209,102,.4)}.health-verdict.bad{background:rgba(255,124,136,.14);color:var(--red);border-color:rgba(255,124,136,.4)}</style>`,
  );

  html = replaceRequired(
    html,
    '  <div id="error" class="error"></div>',
    `  <div id="error" class="error"></div>

  <section class="card">
    <div class="between"><div><h2 style="margin:0">Resumen de la operativa</h2><div class="muted" style="font-size:12px;margin-top:5px">Qué ha comprado y vendido el sistema PAPER, cuánto vale ahora y cuál es el resultado.</div></div><span id="executivePositionBadge" class="badge">Cargando</span></div>
    <div id="executiveGrid" class="executive-grid"></div>
    <div class="between" style="margin-top:18px"><div><h3 style="margin:0">Últimas operaciones</h3><div class="muted" style="font-size:12px;margin-top:4px">Las más recientes aparecen primero.</div></div><span id="executiveLastDecision" class="muted" style="font-size:12px"></span></div>
    <div id="executiveTrades" class="latest-trades"></div>
  </section>

  <section class="card">
    <div class="between"><div><h2 style="margin:0">Salud del sistema</h2><div class="muted" style="font-size:12px;margin-top:5px">Diagnóstico técnico; la operativa y el resultado aparecen arriba.</div></div><span id="healthVerdict" class="badge health-verdict">Calculando</span></div>
    <div id="healthGrid" class="health-grid"></div>
  </section>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function executiveStrategy(lab,demo){
    const strategies=Array.isArray(lab&&lab.state&&lab.state.strategies)?lab.state.strategies:[];
    const selectedId=demo&&demo.selectedStrategy?demo.selectedStrategy.id:null;
    return strategies.find(function(s){return s.id===selectedId})||strategies[0]||null;
  }
  function executiveRelativeTime(timestamp){
    const value=Number(timestamp);if(!Number.isFinite(value))return '—';
    const seconds=Math.max(0,Math.round((Date.now()-value)/1000));
    if(seconds<60)return 'hace '+seconds+' s';
    const minutes=Math.floor(seconds/60);if(minutes<60)return 'hace '+minutes+' min';
    const hours=Math.floor(minutes/60);if(hours<24)return 'hace '+hours+' h';
    return new Date(value).toLocaleString('es-ES');
  }
  function renderExecutiveSummary(lab,demo){
    const strategy=executiveStrategy(lab,demo);const grid=document.getElementById('executiveGrid');const tradesWrap=document.getElementById('executiveTrades');const positionBadge=document.getElementById('executivePositionBadge');const lastDecision=document.getElementById('executiveLastDecision');
    if(!strategy){grid.innerHTML='<div class="empty-state">Esperando datos de la primera estrategia.</div>';tradesWrap.innerHTML='';positionBadge.textContent='Sin datos';lastDecision.textContent='';return}
    const trades=Array.isArray(strategy.trades)?strategy.trades.slice().sort(function(a,b){return Number(b.timestamp)-Number(a.timestamp)}):[];
    const buys=trades.filter(function(t){return t.side==='buy'}).length;const sells=trades.filter(function(t){return t.side==='sell'}).length;
    const perf=strategy.performance||{};const net=Number(perf.netPnlEur)||0;const initial=Number(strategy.initialCashEur)||50;const equity=Number(strategy.equityEur);const current=Number.isFinite(equity)?equity:initial;const netPct=initial?net/initial:0;
    const position=strategy.position;positionBadge.textContent=position?'Posición abierta':'Sin posición abierta';positionBadge.className='badge '+(position?'positive':'');
    grid.innerHTML=[
      ['Capital actual',money(current),pnlClass(current-initial)],
      ['Resultado neto',money(net)+' · '+pct(netPct),pnlClass(net)],
      ['Compras',String(buys),'positive'],
      ['Ventas',String(sells),'negative'],
      ['Operaciones cerradas',String(perf.closedTrades||0),''],
      ['Posiciones abiertas',position?'1':'0',position?'positive':''],
      ['Ganadoras / perdedoras',(perf.winningTrades||0)+' / '+(perf.losingTrades||0),''],
      ['Comisiones',money(Number(perf.totalFeesEur)||0),'']
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong class="'+item[2]+'">'+item[1]+'</strong></div>'}).join('');
    lastDecision.textContent=strategy.lastDecision?('Última decisión: '+strategy.lastDecision):'';
    const recent=trades.slice(0,5);
    tradesWrap.innerHTML=recent.length?recent.map(function(trade){
      const side=trade.side==='buy'?'Compra':'Venta';const sideClass=trade.side==='buy'?'buy':'sell';const result=trade.side==='sell'&&Number.isFinite(Number(trade.pnlEur))?money(Number(trade.pnlEur)):'—';
      return '<div class="latest-trade"><span class="badge trade-side '+sideClass+'">'+side+'</span><div class="trade-main"><strong>'+escapeHtml(humanMarket(strategy.symbol||'XBTEUR'))+' · '+money(Number(trade.price)||0)+'</strong><span>'+escapeHtml(trade.reason||'Sin motivo registrado')+'</span></div><div class="trade-meta"><strong class="'+pnlClass(Number(trade.pnlEur))+'">'+result+'</strong><span>'+executiveRelativeTime(trade.timestamp)+'</span></div></div>';
    }).join(''):'<div class="empty-state">Todavía no hay compras ni ventas registradas.</div>';
  }
  function renderSystemHealth(lab,readiness,markets){
    const badge=document.getElementById('healthVerdict');const grid=document.getElementById('healthGrid');
    const state=lab&&lab.state?lab.state:{};const strategies=Array.isArray(state.strategies)?state.strategies:[];
    const lastCycle=Number(state.lastCycleAt);const labStale=!Number.isFinite(lastCycle)||(Date.now()-lastCycle)>15*60*1000;
    const marketOk=Boolean(markets)&&markets.available!==false;
    const errorRateOk=!readiness||!readiness.checks||readiness.checks.errorRateAccepted!==false;
    const activeCount=strategies.filter(function(s){return s.status==='active'}).length;
    const haltedCount=strategies.filter(function(s){return s.status==='halted'}).length;
    const erroredCount=strategies.filter(function(s){return s.status==='error'}).length;
    const bad=!marketOk||labStale||!errorRateOk||erroredCount>0;
    const warn=!bad&&haltedCount>0;
    badge.className='badge health-verdict '+(bad?'bad':warn?'warn':'ok');
    badge.textContent=bad?'Con incidencias':warn?'Parcialmente operativo':'Todo operativo';
    grid.innerHTML=[
      ['Mercado Kraken',marketOk?'Operativo':'Sin datos recientes'+(markets&&markets.error?' ('+markets.error+')':'')],
      ['Ciclo del laboratorio',labStale?'Sin ciclo en los últimos 15 min':'Reciente'],
      ['Motor principal (errores)',readiness?(readiness.successfulTickAttempts||0)+' correctos / '+(readiness.errorsObserved||0)+' con error':'—'],
      ['Estrategias',activeCount+' activas · '+haltedCount+' detenidas · '+erroredCount+' con error']
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong>'+escapeHtml(item[1])+'</strong></div>'}).join('');
  }
`,
  );

  html = replaceRequired(
    html,
    "renderActivity(lab,demo);renderAdvanced(lab,demo);renderPilotInfo(readiness);renderSystemHealth(lab,readiness,markets);document.getElementById('raw').textContent=JSON.stringify({shadowLiveDemo:demo,readiness:readiness,marketUniverse:markets,committee:lab.committee,committeeImpact:lab.committeeImpact,paperEvidenceLedger:lab.paperEvidenceLedger,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite,frozenForwardExperiment:lab.frozenForwardExperiment,frozenForwardStatus:lab.frozenForwardStatus},null,2);",
    "renderActivity(lab,demo);renderAdvanced(lab,demo);renderPilotInfo(readiness);renderExecutiveSummary(lab,demo);renderSystemHealth(lab,readiness,markets);document.getElementById('raw').textContent=JSON.stringify({shadowLiveDemo:demo,readiness:readiness,marketUniverse:markets,committee:lab.committee,committeeImpact:lab.committeeImpact,paperEvidenceLedger:lab.paperEvidenceLedger,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite,frozenForwardExperiment:lab.frozenForwardExperiment,frozenForwardStatus:lab.frozenForwardStatus},null,2);",
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
