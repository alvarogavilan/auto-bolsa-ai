import { timelineDemoDashboard } from "./demo-dashboard-timeline";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) throw new Error(`DEMO_HEALTH_MARKER_MISSING:${search.slice(0, 48)}`);
  return source.replace(search, replacement);
}

export async function healthDemoDashboard(): Promise<Response> {
  const base = await timelineDemoDashboard();
  let html = await base.text();

  html = replaceRequired(html, "</style>", `.executive-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:12px}.executive-grid .mini strong{font-size:20px}.latest-trades{display:grid;gap:8px;margin-top:12px}.latest-trade{display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:12px;border:1px solid var(--line);border-radius:14px;background:rgba(4,17,31,.42)}.trade-side{min-width:68px;text-align:center}.trade-side.buy{background:rgba(73,221,161,.14);color:var(--green)}.trade-side.sell{background:rgba(255,124,136,.14);color:var(--red)}.trade-main strong,.trade-main span{display:block}.trade-main span,.trade-meta{font-size:12px;color:var(--muted)}.trade-meta{text-align:right}.health-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:12px}.health-verdict.ok{background:rgba(73,221,161,.14);color:var(--green)}.health-verdict.warn{background:rgba(255,209,102,.14);color:var(--amber)}.health-verdict.bad{background:rgba(255,124,136,.14);color:var(--red)}@media(max-width:720px){.executive-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:440px){.health-grid{grid-template-columns:1fr}.latest-trade{grid-template-columns:auto 1fr}.trade-meta{grid-column:2;text-align:left}}</style>`);

  html = replaceRequired(html, '  <div id="error" class="error"></div>', `  <div id="error" class="error"></div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Resumen de la operativa</h2><div class="muted" style="font-size:12px;margin-top:5px">Compras, ventas, capital y resultado PAPER en un solo vistazo.</div></div><span id="executivePositionBadge" class="badge">Cargando</span></div>
    <div id="executiveGrid" class="executive-grid"></div>
    <div class="between" style="margin-top:18px"><h3 style="margin:0">Últimas operaciones</h3><span id="executiveLastDecision" class="muted" style="font-size:12px"></span></div>
    <div id="executiveTrades" class="latest-trades"></div>
  </section>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Salud del sistema</h2><div class="muted" style="font-size:12px;margin-top:5px">Diagnóstico técnico; la operativa aparece arriba.</div></div><span id="healthVerdict" class="badge health-verdict">Calculando</span></div>
    <div id="healthGrid" class="health-grid"></div>
  </section>`);

  html = replaceRequired(html, "<script>\n", `<script>
  function executiveStrategy(lab,demo){const xs=Array.isArray(lab&&lab.state&&lab.state.strategies)?lab.state.strategies:[];const id=demo&&demo.selectedStrategy?demo.selectedStrategy.id:null;return xs.find(function(s){return s.id===id})||xs[0]||null}
  function executiveRelativeTime(ts){const v=Number(ts);if(!Number.isFinite(v))return '—';const s=Math.max(0,Math.round((Date.now()-v)/1000));if(s<60)return 'hace '+s+' s';const m=Math.floor(s/60);if(m<60)return 'hace '+m+' min';const h=Math.floor(m/60);return h<24?'hace '+h+' h':new Date(v).toLocaleString('es-ES')}
  function renderExecutiveSummary(lab,demo){
    const s=executiveStrategy(lab,demo),grid=document.getElementById('executiveGrid'),list=document.getElementById('executiveTrades'),badge=document.getElementById('executivePositionBadge'),decision=document.getElementById('executiveLastDecision');
    if(!s){grid.innerHTML='<div class="empty-state">Esperando datos de la primera estrategia.</div>';list.innerHTML='';badge.textContent='Sin datos';return}
    const trades=Array.isArray(s.trades)?s.trades.slice().sort(function(a,b){return Number(b.timestamp)-Number(a.timestamp)}):[],perf=s.performance||{},initial=Number(s.initialCashEur)||50,equity=Number(s.equityEur),current=Number.isFinite(equity)?equity:initial,net=Number(perf.netPnlEur)||0;
    const buys=trades.filter(function(t){return t.side==='buy'}).length,sells=trades.filter(function(t){return t.side==='sell'}).length;
    badge.textContent=s.position?'Posición abierta':'Sin posición abierta';badge.className='badge '+(s.position?'positive':'');decision.textContent=s.lastDecision?'Última decisión: '+s.lastDecision:'';
    grid.innerHTML=[['Capital actual',money(current),pnlClass(current-initial)],['Resultado neto',money(net)+' · '+pct(initial?net/initial:0),pnlClass(net)],['Compras',String(buys),'positive'],['Ventas',String(sells),'negative'],['Operaciones cerradas',String(perf.closedTrades||0),''],['Posiciones abiertas',s.position?'1':'0',s.position?'positive':''],['Ganadoras / perdedoras',(perf.winningTrades||0)+' / '+(perf.losingTrades||0),''],['Comisiones',money(Number(perf.totalFeesEur)||0),'']].map(function(x){return '<div class="mini"><span>'+escapeHtml(x[0])+'</span><strong class="'+x[2]+'">'+x[1]+'</strong></div>'}).join('');
    list.innerHTML=trades.length?trades.slice(0,5).map(function(t){const buy=t.side==='buy',result=!buy&&Number.isFinite(Number(t.pnlEur))?money(Number(t.pnlEur)):'—';return '<div class="latest-trade"><span class="badge trade-side '+(buy?'buy':'sell')+'">'+(buy?'Compra':'Venta')+'</span><div class="trade-main"><strong>'+escapeHtml(humanMarket(s.symbol||'XBTEUR'))+' · '+money(Number(t.price)||0)+'</strong><span>'+escapeHtml(t.reason||'Sin motivo registrado')+'</span></div><div class="trade-meta"><strong class="'+pnlClass(Number(t.pnlEur))+'">'+result+'</strong><span>'+executiveRelativeTime(t.timestamp)+'</span></div></div>'}).join(''):'<div class="empty-state">Todavía no hay compras ni ventas registradas.</div>';
  }
  function renderSystemHealth(lab,readiness,markets){
    const badge=document.getElementById('healthVerdict'),grid=document.getElementById('healthGrid'),state=lab&&lab.state?lab.state:{},strategies=Array.isArray(state.strategies)?state.strategies:[],last=Number(state.lastCycleAt),stale=!Number.isFinite(last)||(Date.now()-last)>15*60*1000,marketOk=Boolean(markets)&&markets.available!==false,errorOk=!readiness||!readiness.checks||readiness.checks.errorRateAccepted!==false,active=strategies.filter(function(s){return s.status==='active'}).length,halted=strategies.filter(function(s){return s.status==='halted'}).length,errored=strategies.filter(function(s){return s.status==='error'}).length,bad=!marketOk||stale||!errorOk||errored>0,warn=!bad&&halted>0;
    badge.className='badge health-verdict '+(bad?'bad':warn?'warn':'ok');badge.textContent=bad?'Con incidencias':warn?'Parcialmente operativo':'Todo operativo';
    grid.innerHTML=[['Mercado Kraken',marketOk?'Operativo':'Sin datos recientes'],['Ciclo del laboratorio',stale?'Sin ciclo en los últimos 15 min':'Reciente'],['Motor principal (errores)',readiness?(readiness.successfulTickAttempts||0)+' correctos / '+(readiness.errorsObserved||0)+' con error':'—'],['Estrategias',active+' activas · '+halted+' detenidas · '+errored+' con error']].map(function(x){return '<div class="mini"><span>'+escapeHtml(x[0])+'</span><strong>'+escapeHtml(x[1])+'</strong></div>'}).join('')
  }
`);

  html = replaceRequired(html, "renderPilotInfo(readiness);document.getElementById('raw')", "renderPilotInfo(readiness);renderExecutiveSummary(lab,demo);renderSystemHealth(lab,readiness,markets);document.getElementById('raw')");

  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
}
