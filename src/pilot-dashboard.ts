// Consola visual de solo lectura para el futuro piloto manual LIVE.
//
// Esta pantalla es puramente de presentación: no está enlazada a ninguna
// ruta, no añade ningún binding ni cron, y su único efecto de red es un
// `fetch('/api/pilot/readiness')` GET desde el navegador del usuario. No
// existe ningún botón que envíe una orden, ni ningún camino hacia Kraken.
// El endpoint que consume puede evolucionar su forma exacta con el tiempo;
// por eso cada sección lee varios nombres de campo plausibles y muestra
// "No disponible" en vez de fallar si el dato todavía no existe.
export function pilotDashboard(): Response {
  const html = `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#07111f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Auto Bolsa AI · Piloto LIVE</title>
  <style>
    :root{color-scheme:dark;--bg:#07111f;--panel:#0f1d31;--panel2:#13253d;--line:#263c5c;--text:#f6f8fc;--muted:#9eb0c9;--green:#49dda1;--red:#ff7c88;--amber:#ffd166;--blue:#69a7ff}
    *{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top,#123057 0,#07111f 38%);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Display",Inter,Arial,sans-serif;min-height:100vh}
    main{max-width:720px;margin:auto;padding:calc(20px + env(safe-area-inset-top)) 16px calc(36px + env(safe-area-inset-bottom))}
    .hero{padding:20px;border:1px solid #31517d;border-radius:24px;background:linear-gradient(145deg,rgba(26,58,96,.94),rgba(11,28,50,.97));box-shadow:0 18px 60px rgba(0,0,0,.28)}
    .topline,.between{display:flex;align-items:center;justify-content:space-between;gap:12px}.brand{font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:#b9d2f4;font-weight:800}
    .badge{display:inline-flex;align-items:center;gap:7px;border-radius:999px;padding:8px 11px;font-size:12px;font-weight:800;background:#19334f;border:1px solid #365c84}.dot{width:8px;height:8px;border-radius:50%;background:var(--amber);box-shadow:0 0 0 4px rgba(255,209,102,.12)}
    h1{font-size:26px;line-height:1.1;margin:17px 0 8px}.subtitle{color:var(--muted);margin:0;line-height:1.45;font-size:14px}
    .safe{margin-top:14px;padding:12px 13px;border-radius:14px;background:rgba(255,209,102,.1);border:1px solid rgba(255,209,102,.32);color:#ffe9b8;font-size:13px;font-weight:700;line-height:1.5}
    button{appearance:none;border:0;border-radius:13px;padding:11px 13px;background:#eef5ff;color:#102038;font-weight:800;font:inherit;cursor:pointer}.small{font-size:13px;padding:9px 11px}.muted{color:var(--muted)}
    .card{background:rgba(15,29,49,.94);border:1px solid var(--line);border-radius:19px;padding:17px;margin:12px 0}.card h2{font-size:16px;margin:0 0 12px}
    .section-title{margin:22px 2px 9px;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#b3c6df;font-weight:850}
    .status-message{padding:12px 13px;border-radius:14px;background:#0b192b;border-left:4px solid var(--blue);line-height:1.45;font-size:14px}
    .grid2{display:grid;grid-template-columns:1fr 1fr;gap:10px}.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
    .mini{padding:11px;background:#0c1a2d;border-radius:13px}.mini span{display:block;color:var(--muted);font-size:11px;margin-bottom:5px}.mini strong{font-size:14px;word-break:break-word}
    .positive{color:var(--green)!important}.negative{color:var(--red)!important}.neutral{color:var(--text)!important}
    .list{display:flex;flex-direction:column;gap:7px}.item{font-size:13px;padding:9px 10px;border-radius:11px;background:#0c1a2d;line-height:1.4}
    .item.blocker{color:#ffd0d5;border-left:3px solid var(--red)}.item.warning{color:#ffe9b8;border-left:3px solid var(--amber)}.item.passed{color:#baf5dc;border-left:3px solid var(--green)}
    .empty-state{text-align:center;padding:16px 10px;color:var(--muted);font-size:13px}
    details{margin-top:10px}summary{cursor:pointer;color:var(--muted);font-size:13px}pre{white-space:pre-wrap;word-break:break-word;font-size:11px;color:#aebed3;background:#071321;padding:12px;border-radius:13px;max-height:330px;overflow:auto}
    .error{display:none;margin:12px 0;padding:13px;border-radius:14px;background:rgba(255,124,136,.12);border:1px solid rgba(255,124,136,.35);color:#ffd0d5}
    .footer{text-align:center;color:#7f93ad;font-size:12px;margin-top:20px;line-height:1.6}
    @media(max-width:440px){main{padding-left:12px;padding-right:12px}.hero{padding:16px}h1{font-size:22px}.grid3{grid-template-columns:1fr 1fr}}
  </style>
</head>
<body><main>
  <section class="hero">
    <div class="topline"><div class="brand">Auto Bolsa AI</div><div id="statusBadge" class="badge"><span class="dot"></span><span>Cargando</span></div></div>
    <h1>Consola del piloto LIVE</h1>
    <p class="subtitle">Vista de solo lectura del estado técnico de un futuro piloto manual. No es un panel de control.</p>
    <div class="safe">Esta pantalla es de solo lectura: nunca envía órdenes, nunca activa el trading real y no existe ningún botón de envío.</div>
    <div class="between" style="margin-top:14px"><span id="updated" class="muted" style="font-size:12px">Cargando datos…</span><button class="small" onclick="loadPilot(true)">Actualizar</button></div>
  </section>

  <div id="error" class="error"></div>

  <div class="section-title">Estado general</div>
  <section class="card">
    <div id="message" class="status-message">Cargando el informe de preparación…</div>
  </section>

  <div class="section-title">Bloqueadores</div>
  <section class="card"><div id="blockers" class="list"><div class="empty-state">Cargando…</div></div></section>

  <div class="section-title">Avisos</div>
  <section class="card"><div id="warnings" class="list"><div class="empty-state">Cargando…</div></div></section>

  <div class="section-title">Comprobaciones superadas</div>
  <section class="card"><div id="passedChecks" class="list"><div class="empty-state">Cargando…</div></div></section>

  <div class="section-title">Evidencia PAPER</div>
  <section class="card">
    <div class="grid3">
      <div class="mini"><span>Días observados</span><strong id="paperDays">—</strong></div>
      <div class="mini"><span>Velas cerradas únicas</span><strong id="paperCandles">—</strong></div>
      <div class="mini"><span>Operaciones cerradas</span><strong id="paperTrades">—</strong></div>
      <div class="mini"><span>PnL neto</span><strong id="paperPnl">—</strong></div>
      <div class="mini"><span>Profit factor</span><strong id="paperProfitFactor">—</strong></div>
      <div class="mini"><span>Drawdown máximo</span><strong id="paperDrawdown">—</strong></div>
      <div class="mini"><span>Tasa de error</span><strong id="paperErrorRate">—</strong></div>
      <div class="mini"><span>Elegible para revisión</span><strong id="paperEligible">—</strong></div>
    </div>
  </section>

  <div class="section-title">Conexión Kraken</div>
  <section class="card">
    <div class="grid3">
      <div class="mini"><span>Conexión</span><strong id="krakenConnection">—</strong></div>
      <div class="mini"><span>Permisos seguros</span><strong id="krakenPermissions">—</strong></div>
      <div class="mini"><span>Saldo EUR</span><strong id="krakenBalance">—</strong></div>
    </div>
    <p class="muted" style="font-size:12px;margin:10px 0 0">Esta pantalla nunca muestra el nombre de la API key, la clave, el secreto ni la lista completa de permisos.</p>
  </section>

  <div class="section-title">Mercado seleccionado</div>
  <section class="card">
    <div class="grid3">
      <div class="mini"><span>Par</span><strong id="marketPair">—</strong></div>
      <div class="mini"><span>Mínimo de orden</span><strong id="marketMinimum">—</strong></div>
      <div class="mini"><span>Precisión</span><strong id="marketPrecision">—</strong></div>
      <div class="mini"><span>Spread</span><strong id="marketSpread">—</strong></div>
      <div class="mini"><span>Frescura</span><strong id="marketFreshness">—</strong></div>
    </div>
  </section>

  <div class="section-title">Orden preparada</div>
  <section class="card">
    <div id="orderEmpty" class="empty-state">No hay ninguna orden preparada.</div>
    <div id="orderGrid" class="grid3" style="display:none">
      <div class="mini"><span>Lado</span><strong id="orderSide">—</strong></div>
      <div class="mini"><span>Par</span><strong id="orderPair">—</strong></div>
      <div class="mini"><span>Tipo</span><strong id="orderType">—</strong></div>
      <div class="mini"><span>Volumen</span><strong id="orderVolume">—</strong></div>
      <div class="mini"><span>Precio</span><strong id="orderPrice">—</strong></div>
      <div class="mini"><span>Importe (máx. 5 €)</span><strong id="orderNotional">—</strong></div>
    </div>
  </section>

  <div class="section-title">Certificado de preflight (validate=true)</div>
  <section class="card"><div id="certificate" class="status-message">—</div></section>

  <div class="section-title">Journal de envío</div>
  <section class="card"><div id="journal" class="status-message">—</div></section>

  <div class="section-title">Reconciliación</div>
  <section class="card"><div id="reconciliation" class="status-message">—</div></section>

  <div class="section-title">Emergencia y liquidación manual</div>
  <section class="card"><div id="emergency" class="status-message">—</div></section>

  <section class="card">
    <details><summary>Ver informe técnico completo</summary><pre id="raw">Cargando…</pre></details>
  </section>

  <div class="footer">Panel exclusivamente informativo. No envía órdenes, no activa el trading real y no sustituye la revisión humana antes de un piloto manual.</div>

<script>
  const euro=new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:6});
  const decimal=new Intl.NumberFormat('es-ES',{maximumFractionDigits:8});
  const dateTime=new Intl.DateTimeFormat('es-ES',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  function escapeHtml(value){return String(value??'').replace(/[&<>"']/g,function(c){return({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'})[c]})}
  function money(value){return Number.isFinite(Number(value))?euro.format(Number(value)):'No disponible'}
  function number(value){return Number.isFinite(Number(value))?decimal.format(Number(value)):'No disponible'}
  function pct(value){return Number.isFinite(Number(value))?Number(value).toFixed(2).replace('.',',')+' %':'No disponible'}
  function time(value){return Number.isFinite(Number(value))?dateTime.format(new Date(Number(value))):'No disponible'}
  function yesNo(value){return value===true?'Sí':value===false?'No':'No disponible'}
  function pnlClass(value){return Number(value)>0?'positive':Number(value)<0?'negative':'neutral'}
  function pick(source,paths){for(const path of paths){const value=path.split('.').reduce(function(acc,key){return acc&&typeof acc==='object'?acc[key]:undefined},source);if(value!==undefined&&value!==null)return value}return null}

  function overallStatus(data){
    const blockers=Array.isArray(data.blockers)?data.blockers:[];
    const eligible=data.eligibleForManualPilotReview===true||data.infrastructureEligibleForManualReview===true;
    const previousVerified=data.previousPilotCycleVerified===true;
    if(previousVerified)return'previous_cycle_verified';
    if(blockers.length>0)return'blocked';
    if(eligible)return'eligible';
    return'preparing';
  }
  const STATUS_INFO={
    blocked:['Bloqueado','var(--red)'],
    preparing:['Preparando','var(--amber)'],
    eligible:['Elegible para revisión','var(--green)'],
    previous_cycle_verified:['Ciclo anterior verificado','var(--blue)']
  };

  function renderList(elementId,items,className){
    const el=document.getElementById(elementId);
    if(!Array.isArray(items)||items.length===0){el.innerHTML='<div class="empty-state">Sin elementos.</div>';return}
    el.innerHTML=items.map(function(item){return '<div class="item '+className+'">'+escapeHtml(String(item))+'</div>'}).join('');
  }

  function renderPaper(paper){
    paper=paper||{};
    document.getElementById('paperDays').textContent=Number.isFinite(Number(paper.daysObserved))?String(paper.daysObserved):'No disponible';
    document.getElementById('paperCandles').textContent=Number.isFinite(Number(paper.uniqueClosedCandlesObserved))?String(paper.uniqueClosedCandlesObserved):'No disponible';
    document.getElementById('paperTrades').textContent=Number.isFinite(Number(paper.closedTrades))?String(paper.closedTrades):'No disponible';
    const pnlEl=document.getElementById('paperPnl');pnlEl.textContent=money(paper.netPnlEur);pnlEl.className=pnlClass(paper.netPnlEur);
    document.getElementById('paperProfitFactor').textContent=paper.profitFactor===null||paper.profitFactor===undefined?'No disponible':number(paper.profitFactor);
    document.getElementById('paperDrawdown').textContent=pct(paper.maxObservedDrawdownPct??paper.currentDrawdownPct);
    document.getElementById('paperErrorRate').textContent=pct(paper.errorRatePct);
    document.getElementById('paperEligible').textContent=yesNo(paper.eligibleForLiveReview);
  }

  function renderKraken(kraken){
    kraken=kraken||{};const connection=kraken.connection||{};const permissions=kraken.permissions||{};
    document.getElementById('krakenConnection').textContent=connection.connected===true?'Conectado':connection.configured===true?'Configurado, sin confirmar':'No configurado';
    document.getElementById('krakenPermissions').textContent=permissions.auditComplete===true&&permissions.safePermissions===true?'Auditados y seguros':permissions.auditComplete===true?'Auditados, no seguros':'Auditoría incompleta';
    document.getElementById('krakenBalance').textContent=money(connection.eurBalance);
  }

  function renderMarket(data){
    const market=pick(data,['market','pairMetadata','executor.pairMetadata'])||{};
    document.getElementById('marketPair').textContent=pick(market,['pair','symbol','canonicalPair','requestedPair'])||'No disponible';
    const minimum=pick(market,['orderMinBase','minimumOrderBase','metadata.orderMinBase']);
    document.getElementById('marketMinimum').textContent=minimum===null?'No disponible':number(minimum);
    const decimals=pick(market,['priceDecimals','pricePrecision','metadata.priceDecimals']);
    document.getElementById('marketPrecision').textContent=decimals===null?'No disponible':String(decimals)+' decimales';
    document.getElementById('marketSpread').textContent=pct(pick(market,['spreadPct','spread']));
    const freshness=pick(market,['checkedAt','lastUpdatedAt','freshAt']);
    document.getElementById('marketFreshness').textContent=freshness===null?'No disponible':time(freshness);
  }

  function renderOrder(data){
    const order=pick(data,['executor.order','preparedOrder','order']);
    const empty=document.getElementById('orderEmpty');const grid=document.getElementById('orderGrid');
    if(!order){empty.style.display='block';grid.style.display='none';return}
    empty.style.display='none';grid.style.display='grid';
    document.getElementById('orderSide').textContent=order.side==='buy'?'Compra':order.side==='sell'?'Venta':'No disponible';
    document.getElementById('orderPair').textContent=order.pair||'No disponible';
    document.getElementById('orderType').textContent=order.type||order.ordertype||'Límite';
    document.getElementById('orderVolume').textContent=number(order.volumeBase);
    document.getElementById('orderPrice').textContent=money(order.limitPrice);
    document.getElementById('orderNotional').textContent=money(order.notionalEur);
  }

  const CERTIFICATE_LABELS={absent:'Ausente',valid:'Válido',expired:'Caducado',consumed:'Consumido',invalid:'Inválido'};
  function renderCertificate(data){
    const status=pick(data,['preflightCertificate.status','certificate.status']);
    document.getElementById('certificate').textContent=status&&CERTIFICATE_LABELS[status]?'Estado: '+CERTIFICATE_LABELS[status]:'No disponible todavía en el informe.';
  }

  const JOURNAL_LABELS={none:'Sin entrada (none)',intent_persisted:'Intención persistida',transport_outcome_recorded:'Desenlace de transporte registrado',reconciled:'Reconciliado'};
  function renderJournal(data){
    const phase=pick(data,['submissionJournal.phase','journal.phase']);
    document.getElementById('journal').textContent=phase&&JOURNAL_LABELS[phase]?'Fase: '+JOURNAL_LABELS[phase]:'No disponible todavía en el informe.';
  }

  function renderReconciliation(data){
    const everRun=pick(data,['reconciliation.everRun']);
    const ok=pick(data,['reconciliation.ok']);
    const balanceStatus=pick(data,['reconciliation.balanceStatus','executor.lastBalanceCheckStatus']);
    const unresolved=pick(data,['reconciliation.unresolvedOrderCount']);
    const parts=[];
    if(everRun===null&&balanceStatus===null){document.getElementById('reconciliation').textContent='No disponible todavía en el informe.';return}
    parts.push('Balance: '+(balanceStatus||'desconocido'));
    if(everRun!==null)parts.push(everRun?'Reconciliación ejecutada':'Reconciliación nunca ejecutada');
    if(ok!==null)parts.push(ok?'resultado ok':'resultado no ok');
    if(unresolved!==null)parts.push(unresolved+' orden(es) sin resolver');
    document.getElementById('reconciliation').textContent=parts.join(' · ');
  }

  function renderEmergency(data){
    const active=pick(data,['emergency.active','executor.emergencyStopActive']);
    const manual=pick(data,['emergency.manualLiquidationPending','executor.emergencyStopRequiresManualLiquidation']);
    if(active===null&&manual===null){document.getElementById('emergency').textContent='No disponible todavía en el informe.';return}
    document.getElementById('emergency').textContent='Parada de emergencia: '+yesNo(active)+' · Liquidación manual pendiente: '+yesNo(manual);
  }

  function render(data){
    const status=overallStatus(data);const info=STATUS_INFO[status];
    document.getElementById('statusBadge').innerHTML='<span class="dot" style="background:'+info[1]+'"></span><span>'+info[0]+'</span>';
    document.getElementById('updated').textContent='Actualizado '+time(data.generatedAt||Date.now());
    document.getElementById('message').textContent=data.message||'Sin mensaje del informe de preparación.';
    renderList('blockers',data.blockers,'blocker');
    renderList('warnings',data.warnings,'warning');
    renderList('passedChecks',data.passedChecks,'passed');
    renderPaper(data.paper);
    renderKraken(data.kraken);
    renderMarket(data);
    renderOrder(data);
    renderCertificate(data);
    renderJournal(data);
    renderReconciliation(data);
    renderEmergency(data);
    document.getElementById('raw').textContent=JSON.stringify(data,null,2);
  }

  let loading=false;
  async function loadPilot(manual){
    if(loading)return;loading=true;
    const error=document.getElementById('error');
    if(manual)document.getElementById('updated').textContent='Actualizando…';
    try{
      const response=await fetch('/api/pilot/readiness',{cache:'no-store'});
      if(!response.ok)throw new Error('El servidor no devolvió un informe válido');
      const data=await response.json();
      render(data);
      error.style.display='none';
    }catch(e){
      error.textContent='No se pudo cargar el informe de preparación del piloto. Se volverá a intentar automáticamente.';
      error.style.display='block';
    }finally{
      loading=false;
    }
  }
  loadPilot(false);setInterval(function(){loadPilot(false)},15000);
</script>
</main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
