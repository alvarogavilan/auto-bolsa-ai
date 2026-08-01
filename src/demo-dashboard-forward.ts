import { stressDemoDashboard } from "./demo-dashboard-stress";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_FORWARD_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

export async function forwardDemoDashboard(): Promise<Response> {
  const base = await stressDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.forward-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.forward-list{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:12px}.forward-item{padding:12px;border:1px solid #29415f;background:#0b192b;border-radius:14px}.forward-item .meta{font-size:11px;color:var(--muted);margin-top:5px}.forward-item .numbers{display:flex;justify-content:space-between;gap:8px;margin-top:8px;font-size:12px}.blockers{display:grid;gap:7px;margin-top:11px}.blocker{padding:9px 10px;border-radius:11px;background:rgba(255,209,102,.08);border:1px solid rgba(255,209,102,.25);color:#ffe3a8;font-size:12px;line-height:1.4}.frozen-ok{color:var(--green)}.frozen-bad{color:var(--red)}@media(max-width:720px){.forward-grid,.forward-list{grid-template-columns:repeat(2,1fr)}}@media(max-width:440px){.forward-grid,.forward-list{grid-template-columns:1fr}}</style>`,
  );

  html = replaceRequired(
    html,
    '  <div class="section-title">Progreso de validación</div>',
    `  <div class="section-title">Experimento forward congelado</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Prueba fuera de muestra</h2><div class="muted" style="font-size:12px;margin-top:5px">Excluye el historial anterior y detecta cualquier cambio de parámetros o cohorte.</div></div><span id="forwardStatusBadge" class="badge">Pendiente</span></div>
    <div id="forwardMetrics" class="forward-grid" style="margin-top:12px"></div>
    <div id="forwardMessage" class="status-message" style="margin-top:12px">El expediente comenzará en el siguiente ciclo automático válido.</div>
    <div id="forwardBlockers" class="blockers"></div>
    <div id="forwardStrategies" class="forward-list"></div>
    <p class="muted" style="font-size:12px;line-height:1.5;margin-bottom:0">Este experimento no modifica señales, no concede autoridad al comité y no habilita LIVE.</p>
  </section>

  <div class="section-title">Progreso de validación</div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function signedPct(value){
    const numberValue=Number(value);if(!Number.isFinite(numberValue))return '—';
    return (numberValue>0?'+':'')+numberValue.toFixed(3).replace('.',',')+' %';
  }
  function renderFrozenForward(lab){
    const report=lab&&lab.frozenForwardExperiment?lab.frozenForwardExperiment:null;
    const status=lab&&lab.frozenForwardStatus?lab.frozenForwardStatus:{};
    const badge=document.getElementById('forwardStatusBadge');
    const metrics=document.getElementById('forwardMetrics');
    const message=document.getElementById('forwardMessage');
    const blockers=document.getElementById('forwardBlockers');
    const strategies=document.getElementById('forwardStrategies');
    if(status.available===false){
      badge.textContent='Observador no disponible';
      metrics.innerHTML='';
      message.textContent='El expediente forward no pudo actualizarse, pero PAPER continúa por diseño fail-open. Error: '+escapeHtml(status.error||'desconocido');
      blockers.innerHTML='';strategies.innerHTML='';return;
    }
    if(!report){
      badge.textContent='Comienza próximo ciclo';
      metrics.innerHTML='<div class="mini"><span>Estado</span><strong>Pendiente de línea base</strong></div>';
      message.textContent='La primera ejecución automática válida congelará la cohorte y todos sus parámetros. El historial anterior no contará.';
      blockers.innerHTML='';strategies.innerHTML='';return;
    }
    const drift=report.configurationDriftDetected===true;
    badge.textContent=drift?'Cohorte contaminada':report.researchReviewCandidate?'Candidata a revisión':'En observación';
    badge.className='badge '+(drift?'negative':report.parametersFrozen?'positive':'neutral');
    const values=[
      ['Inicio',time(report.initializedAt)],
      ['Días forward',Number(report.forwardDays||0).toFixed(2).replace('.',',')],
      ['Operaciones futuras',report.forwardClosedTrades??0],
      ['Parámetros',report.parametersFrozen?'Congelados':'Deriva detectada'],
      ['Estrategias positivas',report.strategiesWithPositiveForwardPnl??0],
      ['Superan referencia',report.strategiesOutperformingBestPassive??0],
      ['Cohorte',report.strategyCount??0],
      ['Huella',String(report.manifestHash||'').slice(0,10)||'—']
    ];
    metrics.innerHTML=values.map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong>'+escapeHtml(item[1])+'</strong></div>'}).join('');
    message.textContent=report.researchReviewCandidate?'La cohorte cumple los mínimos forward para revisión humana. Aun así, no habilita LIVE.':'La prueba sigue acumulando evidencia nueva con parámetros congelados.';
    const reportBlockers=Array.isArray(report.researchReviewBlockers)?report.researchReviewBlockers:[];
    blockers.innerHTML=reportBlockers.map(function(item){return '<div class="blocker">○ '+escapeHtml(item)+'</div>'}).join('');
    const rows=Array.isArray(report.strategies)?report.strategies.slice().sort(function(a,b){return Number(b.alphaVsBestPassivePct||0)-Number(a.alphaVsBestPassivePct||0)}).slice(0,8):[];
    strategies.innerHTML=rows.length?rows.map(function(item){return '<div class="forward-item"><div class="between"><strong>'+escapeHtml(humanMarket(item.symbol))+' · '+lane(item.lane)+'</strong><span class="badge">'+(item.outperformedBestPassive?'Supera':'No supera')+'</span></div><div class="meta">'+item.forwardClosedTrades+' cierre(s) nuevos · '+item.forwardWinningTrades+' ganadora(s) · '+item.forwardLosingTrades+' perdedora(s)</div><div class="numbers"><span>PnL '+money(item.forwardNetPnlEur)+'</span><strong class="'+pnlClass(item.alphaVsBestPassivePct)+'">Alpha '+signedPct(item.alphaVsBestPassivePct)+'</strong></div></div>'}).join(''):'<div class="empty-state"><strong>Cohorte congelada</strong>Esperando las primeras operaciones completamente posteriores a la línea base.</div>';
  }
`,
  );

  html = replaceRequired(
    html,
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderStress(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo)}",
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderStress(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo);renderFrozenForward(lab)}",
  );

  html = replaceRequired(
    html,
    "committeeImpact:lab.committeeImpact,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite",
    "committeeImpact:lab.committeeImpact,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite,frozenForwardExperiment:lab.frozenForwardExperiment,frozenForwardStatus:lab.frozenForwardStatus",
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
