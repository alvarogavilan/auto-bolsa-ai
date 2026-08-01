import { demoDashboard as baseDemoDashboard } from "./demo-dashboard-base";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_ENHANCEMENT_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

export async function enhancedDemoDashboard(): Promise<Response> {
  const base = baseDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.app-nav{display:flex;gap:8px;overflow:auto;margin:0 0 12px;padding:2px}.app-nav a{white-space:nowrap;text-decoration:none;color:#bad2f0;background:#10243d;border:1px solid #2d4b70;padding:9px 12px;border-radius:999px;font-size:12px;font-weight:800}.app-nav a.active{background:#eef5ff;color:#102038}.heartbeat{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:12px}.feed{display:grid;gap:8px}.feed-item,.vote{padding:12px;border:1px solid #29415f;background:#0b192b;border-radius:14px}.feed-item .when,.vote .role{font-size:11px;color:var(--muted);margin-top:5px}.feed-item .decision,.vote .reason{font-size:12px;color:#c5d5e9;margin-top:6px;line-height:1.4}.committee-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px}.vote.approve{border-color:rgba(73,221,161,.4)}.vote.observe{border-color:rgba(255,209,102,.35)}.vote.veto{border-color:rgba(255,124,136,.45)}.benchmark-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.stale-banner{padding:11px 12px;border-radius:13px;background:rgba(255,124,136,.1);border:1px solid rgba(255,124,136,.35);color:#ffd0d5;font-size:12px;line-height:1.45;margin-top:10px}@media(max-width:720px){.heartbeat,.benchmark-grid{grid-template-columns:repeat(2,1fr)}.committee-grid{grid-template-columns:1fr}}@media(max-width:440px){.heartbeat,.benchmark-grid{grid-template-columns:1fr}}</style>`,
  );

  html = replaceRequired(
    html,
    "<body><main>\n",
    `<body><main>
  <nav class="app-nav" aria-label="Navegación principal">
    <a class="active" href="/demo">DEMO</a>
    <a href="/pilot">Piloto</a>
    <a href="/technical">Técnico</a>
  </nav>
`,
  );

  html = replaceRequired(
    html,
    '  <div class="section-title">Historial de operaciones</div>',
    `  <div class="section-title">Actividad en tiempo real</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Qué está haciendo el sistema</h2><div class="muted" style="font-size:12px;margin-top:5px">Muestra ciclos y decisiones aunque no se abra ninguna operación.</div></div><span id="heartbeatBadge" class="badge">Cargando</span></div>
    <div id="heartbeat" class="heartbeat"></div>
    <div id="staleWarning"></div>
    <div id="decisionFeed" class="feed" style="margin-top:12px"></div>
  </section>

  <div class="section-title">Comité interno · shadow</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Decisión auditada por seis funciones</h2><div class="muted" style="font-size:12px;margin-top:5px">No cambia operaciones: mide primero si los vetos y aprobaciones mejoran el resultado.</div></div><span id="committeeVerdict" class="badge">—</span></div>
    <div id="committeeMessage" class="status-message" style="margin-top:12px">Esperando evaluación.</div>
    <div id="committeeVotes" class="committee-grid" style="margin-top:12px"></div>
  </section>

  <div class="section-title">Comparación exigente</div>
  <section class="card">
    <div><h2 style="margin:0">Estrategia frente a alternativas simples</h2><div class="muted" style="font-size:12px;margin-top:5px">Debe superar tanto conservar efectivo como comprar y mantener el mismo activo.</div></div>
    <div id="benchmarkSuite" class="benchmark-grid" style="margin-top:12px"></div>
    <div id="benchmarkMessage" class="decision"></div>
  </section>

  <div class="section-title">Historial de operaciones</div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function relativeAge(value){
    const timestamp=Number(value);if(!Number.isFinite(timestamp))return 'sin ciclo correcto';
    const seconds=Math.max(0,Math.round((Date.now()-timestamp)/1000));
    if(seconds<60)return 'hace '+seconds+' s';
    const minutes=Math.floor(seconds/60);if(minutes<60)return 'hace '+minutes+' min';
    const hours=Math.floor(minutes/60);return 'hace '+hours+' h';
  }
  function renderSystemActivity(lab){
    const state=lab&&lab.state?lab.state:{};const strategies=Array.isArray(state.strategies)?state.strategies:[];
    const lastCycle=Number(state.lastCycleAt);const age=Number.isFinite(lastCycle)?Date.now()-lastCycle:Number.POSITIVE_INFINITY;
    const stale=age>15*60*1000;const open=strategies.filter(function(s){return s.position!==null}).length;
    const trades=strategies.reduce(function(sum,s){return sum+(Array.isArray(s.trades)?s.trades.length:0)},0);
    const errors=strategies.reduce(function(sum,s){return sum+Number(s.errors||0)},0);
    document.getElementById('heartbeatBadge').textContent=stale?'Sin ciclo reciente':'Automático activo';
    document.getElementById('heartbeat').innerHTML=[
      ['Último ciclo',Number.isFinite(lastCycle)?relativeAge(lastCycle):'pendiente'],
      ['Estrategias',strategies.length],['Posiciones abiertas',open],['Movimientos / errores',trades+' / '+errors]
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong>'+escapeHtml(item[1])+'</strong></div>'}).join('');
    document.getElementById('staleWarning').innerHTML=stale?'<div class="stale-banner"><strong>Atención:</strong> no se observa un ciclo del laboratorio en los últimos 15 minutos. La app seguirá reintentando y mostrará actividad cuando Cloudflare procese el siguiente ciclo.</div>':'';
    const recent=[...strategies].sort(function(a,b){return Number(b.lastSuccessfulAt||b.lastAttemptAt||0)-Number(a.lastSuccessfulAt||a.lastAttemptAt||0)}).slice(0,9);
    document.getElementById('decisionFeed').innerHTML=recent.length?recent.map(function(s){return '<div class="feed-item"><div class="between"><strong>'+escapeHtml(humanMarket(s.symbol))+' · '+lane(s.lane)+'</strong><span class="badge">'+(s.position?'Posición abierta':escapeHtml(s.status||'observando'))+'</span></div><div class="decision">'+escapeHtml(s.lastDecision||'Sin decisión registrada')+'</div><div class="when">Último ciclo correcto '+relativeAge(s.lastSuccessfulAt)+' · próximo '+time(s.nextDueAt)+'</div></div>'}).join(''):'<div class="empty-state"><strong>Laboratorio inicializando</strong>La actividad aparecerá aunque la decisión sea esperar.</div>';
  }
  function selectedCommittee(lab,demo){
    const reports=Array.isArray(lab&&lab.committee&&lab.committee.reports)?lab.committee.reports:[];
    const selected=demo&&demo.selectedStrategy?demo.selectedStrategy.id:null;
    return reports.find(function(report){return report.strategyId===selected})||reports[0]||null;
  }
  function renderCommittee(lab,demo){
    const report=selectedCommittee(lab,demo);const badge=document.getElementById('committeeVerdict');
    if(!report){badge.textContent='Inicializando';document.getElementById('committeeMessage').textContent='El comité aparecerá cuando exista una estrategia PAPER.';document.getElementById('committeeVotes').innerHTML='';return}
    const labels={candidate:'Candidata',observe:'Observación',vetoed:'Vetada'};badge.textContent=labels[report.verdict]||report.verdict;
    document.getElementById('committeeMessage').textContent=report.message+' Modo shadow: no altera ninguna compra o venta.';
    const votes=Array.isArray(report.votes)?report.votes:[];
    document.getElementById('committeeVotes').innerHTML=votes.map(function(vote){const icon=vote.vote==='approve'?'✓':vote.vote==='veto'?'✕':'○';return '<div class="vote '+escapeHtml(vote.vote)+'"><div class="between"><strong>'+icon+' '+escapeHtml(vote.role)+'</strong><span class="badge">'+escapeHtml(vote.vote)+'</span></div><div class="reason">'+escapeHtml(vote.reason)+'</div><div class="role">'+(vote.hardVeto?'Veto duro':'Evaluación informativa')+'</div></div>'}).join('');
  }
  function renderBenchmarkSuite(lab,demo){
    const entries=Array.isArray(lab&&lab.benchmarkSuite&&lab.benchmarkSuite.entries)?lab.benchmarkSuite.entries:[];
    const selected=demo&&demo.selectedStrategy?demo.selectedStrategy.id:null;
    const entry=entries.find(function(item){return item.strategyId===selected})||entries[0]||null;
    if(!entry){document.getElementById('benchmarkSuite').innerHTML='<div class="empty-state">Esperando la primera referencia comparable.</div>';document.getElementById('benchmarkMessage').textContent='';return}
    document.getElementById('benchmarkSuite').innerHTML=[
      ['Estrategia',Number(entry.strategyReturnPct).toFixed(3).replace('.',',')+' %'],
      ['Efectivo','0,000 %'],
      ['Comprar y mantener',entry.buyHoldReturnPct===null?'Pendiente':Number(entry.buyHoldReturnPct).toFixed(3).replace('.',',')+' %'],
      ['Mejor alternativa pasiva',Number(entry.bestPassiveReturnPct).toFixed(3).replace('.',',')+' %'],
      ['Ventaja frente a la mejor',Number(entry.alphaVsBestPassivePct).toFixed(3).replace('.',',')+' %'],
      ['Observaciones benchmark',entry.benchmarkObservations]
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong>'+escapeHtml(item[1])+'</strong></div>'}).join('');
    document.getElementById('benchmarkMessage').textContent=entry.outperformedBestPassive?'La estrategia supera provisionalmente la mejor alternativa pasiva. Falta evidencia fuera de muestra.':'La estrategia aún no supera la mejor alternativa pasiva; no debe promoverse.';
  }
  function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderBenchmarkSuite(lab,demo)}
`,
  );

  html = replaceRequired(
    html,
    "renderPosition(strategy);renderMarkets(markets);renderTrades(lab);renderStrategies(lab);renderReadiness(readiness);renderActivity(lab,demo);document.getElementById('raw').textContent=JSON.stringify({shadowLiveDemo:demo,readiness:readiness,marketUniverse:markets},null,2);",
    "renderPosition(strategy);renderMarkets(markets);renderTrades(lab);renderStrategies(lab);renderReadiness(readiness);renderActivity(lab,demo);renderAdvanced(lab,demo);document.getElementById('raw').textContent=JSON.stringify({shadowLiveDemo:demo,readiness:readiness,marketUniverse:markets,committee:lab.committee,benchmarkSuite:lab.benchmarkSuite},null,2);",
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
