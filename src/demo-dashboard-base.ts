export function demoDashboard(): Response {
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#07111f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Auto Bolsa AI · DEMO</title>
  <style>
    :root{color-scheme:dark;--bg:#07111f;--panel:#0f1d31;--panel2:#13253d;--line:#263c5c;--text:#f6f8fc;--muted:#9eb0c9;--green:#49dda1;--red:#ff7c88;--amber:#ffd166;--blue:#69a7ff}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#123057 0,#07111f 38%);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",Inter,Arial,sans-serif;min-height:100vh}
    main{max-width:960px;margin:auto;padding:calc(20px + env(safe-area-inset-top)) 16px calc(36px + env(safe-area-inset-bottom))}
    .hero{padding:20px;border:1px solid #31517d;border-radius:24px;background:linear-gradient(145deg,rgba(26,58,96,.94),rgba(11,28,50,.97));box-shadow:0 18px 60px rgba(0,0,0,.28)}
    .topline,.between{display:flex;align-items:center;justify-content:space-between;gap:12px}.brand{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#b9d2f4;font-weight:800}
    .badge{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:8px 11px;font-size:12px;font-weight:800;background:#19334f;border:1px solid #365c84}.dot{width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 4px rgba(255,209,102,.12)}
    h1{font-size:30px;line-height:1.05;margin:17px 0 8px}.subtitle{color:var(--muted);margin:0;line-height:1.45}.safe{margin-top:14px;padding:11px 13px;border-radius:14px;background:rgba(73,221,161,.09);border:1px solid rgba(73,221,161,.28);color:#baf5dc;font-size:13px}
    button{appearance:none;border:0;border-radius:13px;padding:11px 13px;background:#eef5ff;color:#102038;font-weight:800;font:inherit;cursor:pointer}.small{font-size:13px;padding:9px 11px}.muted{color:var(--muted)}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin:14px 0}.metric,.card{background:rgba(15,29,49,.94);border:1px solid var(--line);border-radius:19px}.metric{padding:15px}.metric .label{font-size:12px;color:var(--muted);margin-bottom:7px}.metric .value{font-size:22px;font-weight:850;letter-spacing:-.02em}
    .positive{color:var(--green)!important}.negative{color:var(--red)!important}.neutral{color:var(--text)!important}.card{padding:17px;margin:12px 0}.card h2{font-size:18px;margin:0 0 13px}.card h3{font-size:15px;margin:0 0 7px}
    .section-title{margin:24px 2px 9px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#b3c6df;font-weight:850}.status-message{padding:12px 13px;border-radius:14px;background:#0b192b;border-left:4px solid var(--blue);line-height:1.45;font-size:14px}
    .position{padding:16px;border-radius:16px;background:var(--panel2);border:1px solid #294566}.position.empty{border-style:dashed;text-align:center;padding:22px}.position-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:13px}.mini{padding:11px;background:#0c1a2d;border-radius:13px}.mini span{display:block;color:var(--muted);font-size:11px;margin-bottom:5px}.mini strong{font-size:14px}.decision{margin-top:10px;color:#c5d5e9;font-size:13px}
    .trade{display:grid;grid-template-columns:86px 1fr auto;gap:12px;align-items:center;padding:13px 0;border-bottom:1px solid #203650}.trade:last-child{border-bottom:0}.trade-side{font-size:12px;font-weight:850;border-radius:10px;padding:7px 8px;text-align:center}.buy{background:rgba(73,221,161,.12);color:var(--green)}.sell{background:rgba(105,167,255,.12);color:#9cc5ff}.trade-main strong{font-size:14px}.trade-main small{display:block;color:var(--muted);margin-top:5px;line-height:1.35}.trade-money{text-align:right;font-weight:800;font-size:13px}.trade-money small{display:block;color:var(--muted);font-weight:500;margin-top:4px}
    .strategies,.markets{display:grid;grid-template-columns:repeat(2,1fr);gap:10px}.strategy,.market-card{padding:14px;border:1px solid #29415f;background:#0b192b;border-radius:15px}.strategy .name,.market-card .name{font-weight:850}.strategy .meta,.market-card .meta{font-size:12px;color:var(--muted);margin-top:5px}.strategy .numbers,.market-card .numbers{display:flex;justify-content:space-between;gap:8px;margin-top:12px;font-size:13px}.strategy .why,.market-card .why{font-size:12px;color:#b9c8dc;margin-top:9px;line-height:1.35}
    .market-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin:13px 0}.filter-row{display:flex;gap:7px;overflow:auto;padding:3px 0 10px}.filter{background:#152944;color:#bad2f0;border:1px solid #2b4a70;white-space:nowrap}.filter.active{background:#eef5ff;color:#102038}
    .progress{height:9px;border-radius:999px;background:#0a1728;overflow:hidden;margin:11px 0}.progress>div{height:100%;background:linear-gradient(90deg,#4a9dff,#49dda1);border-radius:inherit}.checks{display:grid;grid-template-columns:repeat(2,1fr);gap:7px}.check{font-size:12px;padding:9px 10px;background:#0c1a2d;border-radius:11px}.check.ok{color:#baf5dc}.check.pending{color:#ffdca0}
    .empty-state{text-align:center;padding:25px 10px;color:var(--muted)}.empty-state strong{display:block;color:var(--text);margin-bottom:7px}.error{display:none;margin:12px 0;padding:13px;border-radius:14px;background:rgba(255,124,136,.12);border:1px solid rgba(255,124,136,.35);color:#ffd0d5}
    details{margin-top:14px}summary{cursor:pointer;color:var(--muted);font-size:13px}pre{white-space:pre-wrap;word-break:break-word;font-size:11px;color:#aebed3;background:#071321;padding:12px;border-radius:13px;max-height:330px;overflow:auto}.footer{text-align:center;color:#7f93ad;font-size:12px;margin-top:20px;line-height:1.5}
    @media(max-width:720px){.grid,.market-stats{grid-template-columns:repeat(2,1fr)}.strategies,.markets{grid-template-columns:1fr}.position-grid{grid-template-columns:repeat(2,1fr)}}
    @media(max-width:440px){main{padding-left:12px;padding-right:12px}.hero{padding:17px}h1{font-size:27px}.metric .value{font-size:20px}.trade{grid-template-columns:74px 1fr}.trade-money{grid-column:2;text-align:left}.checks{grid-template-columns:1fr}}
  </style>
</head>
<body><main>
  <section class="hero">
    <div class="topline"><div class="brand">Auto Bolsa AI</div><div id="statusBadge" class="badge"><span class="dot"></span><span>Conectando</span></div></div>
    <h1>DEMO en directo</h1>
    <p class="subtitle">Seguimiento visual de operaciones simuladas y exploración de todos los mercados EUR spot disponibles en Kraken.</p>
    <div class="safe">Capital virtual · No envía órdenes · No toca tu saldo real</div>
    <div class="between" style="margin-top:14px"><span id="updated" class="muted" style="font-size:12px">Cargando datos…</span><button class="small" onclick="loadDemo(true)">Actualizar</button></div>
  </section>

  <div id="error" class="error"></div>

  <section class="grid">
    <div class="metric"><div class="label">Capital inicial</div><div id="capital" class="value">50,00 €</div></div>
    <div class="metric"><div class="label">Valor actual</div><div id="equity" class="value">—</div></div>
    <div class="metric"><div class="label">Resultado neto</div><div id="pnl" class="value">—</div></div>
    <div class="metric"><div class="label">Estrategia destacada</div><div id="market" class="value" style="font-size:16px">—</div></div>
  </section>

  <div class="section-title">Estado actual</div>
  <section class="card">
    <div id="message" class="status-message">Cargando el estado del mercado…</div>
    <div id="positionWrap" style="margin-top:12px"></div>
  </section>

  <div class="section-title">Universo de mercados</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Todo el mercado EUR de Kraken</h2><div class="muted" style="font-size:12px;margin-top:5px">Se escanea el universo completo; solo los mejores candidatos pasan al laboratorio.</div></div><span id="marketGenerated" class="muted" style="font-size:12px">—</span></div>
    <div class="market-stats">
      <div class="mini"><span>Descubiertos</span><strong id="marketsDiscovered">—</strong></div>
      <div class="mini"><span>Online</span><strong id="marketsOnline">—</strong></div>
      <div class="mini"><span>Compatibles con 50 €</span><strong id="marketsCompatible">—</strong></div>
      <div class="mini"><span>Estrategias activas</span><strong id="strategiesActive">—</strong></div>
    </div>
    <div class="filter-row">
      <button class="filter active" data-lane="all" onclick="setMarketFilter('all',this)">Todos</button>
      <button class="filter" data-lane="fast" onclick="setMarketFilter('fast',this)">Rápida</button>
      <button class="filter" data-lane="intraday" onclick="setMarketFilter('intraday',this)">Intradía</button>
      <button class="filter" data-lane="swing" onclick="setMarketFilter('swing',this)">Medio plazo</button>
      <button class="filter" data-lane="compatible" onclick="setMarketFilter('compatible',this)">Compatibles</button>
    </div>
    <div id="markets" class="markets"></div>
  </section>

  <div class="section-title">Historial de operaciones</div>
  <section class="card">
    <div class="between"><h2 style="margin:0">Compras y ventas simuladas</h2><span id="tradeCount" class="muted" style="font-size:12px">0 movimientos</span></div>
    <div id="trades"></div>
  </section>

  <div class="section-title">Estrategias activas</div>
  <section class="card"><div id="strategies" class="strategies"></div></section>

  <div class="section-title">Progreso de validación</div>
  <section class="card">
    <div class="between"><h2 style="margin:0">Expediente PAPER</h2><strong id="progressText">—</strong></div>
    <div class="progress"><div id="progressBar" style="width:0%"></div></div>
    <div id="checks" class="checks"></div>
    <p class="muted" style="font-size:12px;line-height:1.5;margin-bottom:0">El universo amplio sirve para seleccionar. Con 50 € reales no se deben abrir muchas posiciones simultáneas.</p>
  </section>

  <section class="card">
    <div class="between"><h2 style="margin:0">Actividad automática</h2><span class="badge"><span class="dot" style="background:var(--green)"></span>Cloudflare</span></div>
    <div id="activity" class="position-grid"></div>
    <details><summary>Ver datos técnicos</summary><pre id="raw">Cargando…</pre></details>
  </section>

  <div class="footer">Se actualiza automáticamente cada 15 segundos. XBT es Bitcoin; la app muestra nombres humanos para evitar confusiones.</div>

<script>
  const euro=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:4});
  const decimal=new Intl.NumberFormat('es-ES',{maximumFractionDigits:8});
  const compact=new Intl.NumberFormat('es-ES',{notation:'compact',maximumFractionDigits:1});
  const dateTime=new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  const assetNames={BTC:'Bitcoin',XBT:'Bitcoin',ETH:'Ethereum',SOL:'Solana',XRP:'XRP',ADA:'Cardano',DOGE:'Dogecoin',XDG:'Dogecoin',DOT:'Polkadot',LINK:'Chainlink',AVAX:'Avalanche',LTC:'Litecoin',BCH:'Bitcoin Cash',TRX:'TRON',XLM:'Stellar',ATOM:'Cosmos',UNI:'Uniswap',AAVE:'Aave',PAXG:'PAX Gold',USDT:'Tether',USDC:'USD Coin',DAI:'Dai'};
  let marketUniverse=null;let marketFilter='all';
  function money(value){return Number.isFinite(Number(value))?euro.format(Number(value)):'—'}
  function number(value){return Number.isFinite(Number(value))?decimal.format(Number(value)):'—'}
  function pct(value){return Number.isFinite(Number(value))?(Number(value)*100).toFixed(2).replace('.',',')+' %':'—'}
  function time(value){return Number.isFinite(Number(value))?dateTime.format(new Date(Number(value))):'—'}
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]})}
  function lane(value){return value==='fast'?'Rápida':value==='intraday'?'Intradía':value==='swing'?'Medio plazo':String(value||'—')}
  function pnlClass(value){return Number(value)>0?'positive':Number(value)<0?'negative':'neutral'}
  function normalizeBase(symbol){const raw=String(symbol||'').split('/')[0].replace(/^X(?=[A-Z]{3,5}$)/,'');return raw==='XBT'?'BTC':raw==='XDG'?'DOGE':raw}
  function humanMarket(symbol){const base=normalizeBase(symbol);return (assetNames[base]||base)+' ('+base+'/EUR)'}
  function laneEligibility(candidate){const out=[];if(candidate.fastEligible)out.push('Rápida');if(candidate.intradayEligible)out.push('Intradía');if(candidate.swingEligible)out.push('Medio plazo');return out.length?out.join(' · '):'Solo observación'}
  function statusInfo(status){const map={initializing:['Inicializando','var(--amber)'],observing_market:['Observando mercado','var(--green)'],observing_blocked:['Entrada bloqueada','var(--amber)'],simulated_position_open:['Operación abierta','var(--blue)'],safety_halt:['Pausa de seguridad','var(--amber)'],error:['Error aislado','var(--red)']};return map[status]||['Estado desconocido','var(--amber)']}
  function renderPosition(strategy){
    const wrap=document.getElementById('positionWrap');
    if(!strategy){wrap.innerHTML='<div class="position empty"><strong>Esperando inicialización</strong><div>El DEMO seleccionará una estrategia en el próximo ciclo válido.</div></div>';return}
    const name=humanMarket(strategy.symbol);
    if(!strategy.positionOpen||!strategy.position){wrap.innerHTML='<div class="position empty"><strong>Sin operación abierta</strong><div>La estrategia destacada analiza '+escapeHtml(name)+'. El resto de mercados sigue visible más abajo.</div><div class="decision">Última decisión: '+escapeHtml(strategy.lastDecision)+'</div></div>';return}
    const p=strategy.position;const current=Number(strategy.currentReferencePrice);const estimated=Number.isFinite(current)?(current-Number(p.entryPrice))*Number(p.quantity):null;
    wrap.innerHTML='<div class="position"><div class="between"><div><h3>Compra DEMO abierta · '+escapeHtml(name)+'</h3><div class="muted" style="font-size:12px">Entrada '+time(p.entryTime)+'</div></div><span class="badge">'+lane(strategy.lane)+'</span></div><div class="position-grid">'+
      '<div class="mini"><span>Precio de entrada</span><strong>'+money(p.entryPrice)+'</strong></div>'+
      '<div class="mini"><span>Precio actual</span><strong>'+money(strategy.currentReferencePrice)+'</strong></div>'+
      '<div class="mini"><span>Cantidad</span><strong>'+number(p.quantity)+'</strong></div>'+
      '<div class="mini"><span>Capital usado</span><strong>'+money(p.costEur)+'</strong></div>'+
      '<div class="mini"><span>Stop loss</span><strong>'+money(p.stopLoss)+'</strong></div>'+
      '<div class="mini"><span>Objetivo</span><strong>'+money(p.takeProfit)+'</strong></div>'+
      '</div><div class="decision '+pnlClass(estimated)+'">Resultado abierto estimado antes del cierre: '+money(estimated)+'</div></div>';
  }
  function collectTrades(lab){const strategies=Array.isArray(lab?.state?.strategies)?lab.state.strategies:[];const out=[];strategies.forEach(function(strategy){(Array.isArray(strategy.trades)?strategy.trades:[]).forEach(function(trade){out.push({...trade,symbol:strategy.symbol,lane:strategy.lane})})});return out.sort(function(a,b){return Number(b.timestamp)-Number(a.timestamp)})}
  function renderTrades(lab){
    const trades=collectTrades(lab);document.getElementById('tradeCount').textContent=trades.length+' movimiento'+(trades.length===1?'':'s');
    if(!trades.length){document.getElementById('trades').innerHTML='<div class="empty-state"><strong>Aún no hay operaciones</strong>El DEMO no fuerza compras. Aquí aparecerán las compras y ventas simuladas.</div>';return}
    document.getElementById('trades').innerHTML=trades.slice(0,50).map(function(t){const isBuy=t.side==='buy';const result=Number.isFinite(Number(t.pnlEur))?'<div class="'+pnlClass(t.pnlEur)+'">'+money(t.pnlEur)+'</div>':'';return '<div class="trade"><div class="trade-side '+(isBuy?'buy':'sell')+'">'+(isBuy?'COMPRA':'VENTA')+'</div><div class="trade-main"><strong>'+escapeHtml(humanMarket(t.symbol))+' · '+lane(t.lane)+'</strong><small>'+time(t.timestamp)+' · '+escapeHtml(t.reason)+'</small><small>Precio '+money(t.price)+' · Cantidad '+number(t.quantity)+' · Comisión '+money(t.feeEur)+'</small></div><div class="trade-money">'+result+'<small>'+money(t.grossEur)+'</small></div></div>'}).join('');
  }
  function renderStrategies(lab){
    const strategies=Array.isArray(lab?.state?.strategies)?lab.state.strategies:[];
    document.getElementById('strategiesActive').textContent=String(strategies.length);
    if(!strategies.length){document.getElementById('strategies').innerHTML='<div class="empty-state">Inicializando estrategias…</div>';return}
    document.getElementById('strategies').innerHTML=strategies.map(function(s){const net=Number(s.equityEur)-Number(s.initialCashEur);return '<div class="strategy"><div class="between"><div><div class="name">'+escapeHtml(humanMarket(s.symbol))+'</div><div class="meta">'+lane(s.lane)+' · velas de '+s.config.intervalMinutes+' min</div></div><span class="badge">'+(s.position?'Abierta':'Observando')+'</span></div><div class="numbers"><span>Valor '+money(s.equityEur)+'</span><strong class="'+pnlClass(net)+'">'+money(net)+'</strong></div><div class="why">'+escapeHtml(s.lastDecision)+'</div></div>'}).join('');
  }
  function candidateMatches(candidate){
    if(marketFilter==='all')return true;
    if(marketFilter==='compatible')return candidate.capitalFit===true;
    if(marketFilter==='fast')return candidate.fastEligible===true;
    if(marketFilter==='intraday')return candidate.intradayEligible===true;
    if(marketFilter==='swing')return candidate.swingEligible===true;
    return true;
  }
  function setMarketFilter(value,button){marketFilter=value;document.querySelectorAll('.filter').forEach(function(el){el.classList.remove('active')});button.classList.add('active');renderMarkets(marketUniverse)}
  function renderMarkets(universe){
    marketUniverse=universe||null;
    document.getElementById('marketsDiscovered').textContent=universe?String(universe.eurMarketsDiscovered??'—'):'—';
    document.getElementById('marketsOnline').textContent=universe?String(universe.onlineEurMarkets??'—'):'—';
    document.getElementById('marketsCompatible').textContent=universe?String(universe.capitalCompatibleMarkets??'—'):'—';
    document.getElementById('marketGenerated').textContent=universe?'Actualizado '+time(universe.generatedAt):'No disponible';
    const candidates=Array.isArray(universe?.candidates)?universe.candidates.filter(candidateMatches):[];
    if(!candidates.length){document.getElementById('markets').innerHTML='<div class="empty-state"><strong>Sin candidatos en este filtro</strong>El mercado se sigue escaneando automáticamente.</div>';return}
    document.getElementById('markets').innerHTML=candidates.slice(0,30).map(function(c){const spread=Number(c.spreadPct);const range=Number(c.range24hPct);return '<div class="market-card"><div class="between"><div><div class="name">'+escapeHtml(humanMarket(c.symbol))+'</div><div class="meta">'+escapeHtml(laneEligibility(c))+'</div></div><span class="badge">#'+escapeHtml(c.score)+'</span></div><div class="numbers"><span>Precio '+money(c.last)+'</span><span>Vol. '+(Number.isFinite(Number(c.volume24hEur))?compact.format(Number(c.volume24hEur))+' €':'—')+'</span></div><div class="why">Spread '+pct(spread)+' · Rango 24 h '+pct(range)+' · Mínimo estimado '+money(c.estimatedOrderMinimumEur)+(c.capitalFit?' · Compatible con 50 €':' · Excede la asignación')+'</div></div>'}).join('');
  }
  function renderReadiness(readiness){const checks=readiness&&readiness.checks?readiness.checks:{};const entries=Object.entries(checks);const passed=entries.filter(function(e){return e[1]===true}).length;const total=entries.length||7;const progress=Math.round((passed/total)*100);document.getElementById('progressText').textContent=passed+' / '+total;document.getElementById('progressBar').style.width=progress+'%';const labels={enoughDays:'Días mínimos',enoughUniqueClosedCandles:'Velas únicas',enoughClosedTrades:'Operaciones cerradas',positiveNetPnl:'Beneficio neto positivo',profitFactorAccepted:'Profit factor',drawdownAccepted:'Drawdown controlado',errorRateAccepted:'Errores controlados'};document.getElementById('checks').innerHTML=entries.map(function(e){return '<div class="check '+(e[1]?'ok':'pending')+'">'+(e[1]?'✓ ':'○ ')+escapeHtml(labels[e[0]]||e[0])+'</div>'}).join('')}
  function renderActivity(lab,demo){const strategy=demo?.selectedStrategy||null;const activity=demo?.activity||{};const items=[['Ciclos del laboratorio',activity.labCycles??lab?.state?.cycles],['Velas únicas',activity.uniqueClosedCandles],['Operaciones registradas',activity.tradesRecorded],['Próximo ciclo',strategy?time(strategy.nextDueAt):'—']];document.getElementById('activity').innerHTML=items.map(function(item){return '<div class="mini"><span>'+item[0]+'</span><strong>'+escapeHtml(item[1]??'—')+'</strong></div>'}).join('')}
  function render(lab,readiness,markets){
    const demo=lab?.shadowLiveDemo||{};const strategy=demo.selectedStrategy||null;const info=statusInfo(demo.status);const badge=document.getElementById('statusBadge');badge.innerHTML='<span class="dot" style="background:'+info[1]+'"></span><span>'+info[0]+'</span>';
    document.getElementById('updated').textContent='Actualizado '+time(demo.updatedAt||Date.now());document.getElementById('capital').textContent=money(demo.virtualCapitalEur??50);document.getElementById('equity').textContent=strategy?money(strategy.equityEur):'—';
    const pnl=strategy?Number(strategy.netPnlEur):null;const pnlEl=document.getElementById('pnl');pnlEl.textContent=pnl===null?'—':money(pnl);pnlEl.className='value '+pnlClass(pnl);document.getElementById('market').textContent=strategy?humanMarket(strategy.symbol):'Esperando';document.getElementById('message').textContent=demo.message||'Esperando información del DEMO.';
    renderPosition(strategy);renderMarkets(markets);renderTrades(lab);renderStrategies(lab);renderReadiness(readiness);renderActivity(lab,demo);document.getElementById('raw').textContent=JSON.stringify({shadowLiveDemo:demo,readiness:readiness,marketUniverse:markets},null,2);
  }
  let loading=false;
  async function loadDemo(manual){if(loading)return;loading=true;const error=document.getElementById('error');if(manual)document.getElementById('updated').textContent='Actualizando…';try{const responses=await Promise.all([fetch('/api/lab',{cache:'no-store'}),fetch('/api/readiness',{cache:'no-store'}),fetch('/api/markets',{cache:'no-store'})]);if(responses.some(function(r){return !r.ok}))throw new Error('El servidor no devolvió un estado válido');const values=await Promise.all(responses.map(function(r){return r.json()}));render(values[0],values[1],values[2]);error.style.display='none'}catch(e){error.textContent='No se pudo cargar todo el seguimiento. Se volverá a intentar automáticamente.';error.style.display='block'}finally{loading=false}}
  loadDemo(false);setInterval(function(){loadDemo(false)},15000);
</script>
</main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
