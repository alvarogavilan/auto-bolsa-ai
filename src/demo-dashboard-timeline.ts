import { performanceDemoDashboard } from "./demo-dashboard-performance";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_TIMELINE_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

/**
 * Añade la cronología completa de decisiones (motor principal, vía el nuevo
 * endpoint público de solo lectura `/api/decisions`), el detalle de los seis
 * votos del comité por cada operación ya evaluada, y una tarjeta puramente
 * informativa sobre el camino hacia un futuro piloto manual. Ninguna de las
 * tres cosas toca el motor de decisión, la estrategia, ni activa LIVE: solo
 * lee datos ya calculados y expuestos, o texto estático sobre garantías ya
 * aplicadas en otros módulos.
 */
export async function timelineDemoDashboard(): Promise<Response> {
  const base = await performanceDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.timeline-entry{padding:12px;border:1px solid #29415f;background:#0b192b;border-radius:14px;margin-bottom:8px}.timeline-entry .meta{font-size:12px;color:#c5d5e9;margin-top:5px;line-height:1.4}.timeline-entry .badge.buy{background:rgba(73,221,161,.12);color:var(--green)}.timeline-entry .badge.sell{background:rgba(105,167,255,.12);color:#9cc5ff}.vote-detail{border:1px solid #29415f;background:#0b192b;border-radius:14px;padding:12px;margin-bottom:8px}.vote-detail summary{color:var(--text);font-weight:700;font-size:13px}.pilot-note{font-size:12px;line-height:1.6;color:var(--muted)}</style>`,
  );

  html = replaceRequired(
    html,
    '  <div class="section-title">Historial de operaciones</div>',
    `  <div class="section-title">Cronología de decisiones</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Motor principal (par único)</h2><div class="muted" style="font-size:12px;margin-top:5px">Diario de señales del motor de un solo par, independiente del laboratorio multi-estrategia de arriba: incluye también las decisiones de mantener y las bloqueadas.</div></div></div>
    <div id="decisionTimelineStats" class="grid" style="margin-top:12px;grid-template-columns:repeat(4,1fr)"></div>
    <div id="decisionTimelineStatus" class="muted" style="font-size:12px;margin-top:10px">Cargando cronología…</div>
    <div id="decisionTimelineList" style="margin-top:10px"></div>
  </section>

  <div class="section-title">Comité por operación</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Detalle de los seis votos por operación</h2><div class="muted" style="font-size:12px;margin-top:5px">Despliega cada operación reciente para ver el voto y la razón de cada función del comité shadow.</div></div></div>
    <div id="committeeVoteDetail" style="margin-top:12px"></div>
  </section>

  <div class="section-title">Piloto: readiness y manifiesto</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Camino hacia un futuro piloto manual (informativo)</h2></div></div>
    <div id="pilotInfoStatus" class="status-message" style="margin-top:12px">Cargando…</div>
    <p class="pilot-note" style="margin:12px 0 0">Además de la evidencia PAPER de arriba, un piloto manual exige una auditoría de cuenta Kraken limpia, un simulacro de seguridad superado y un certificado <code>validate=true</code> vigente — todo ello visible y accionable solo desde la consola privada autenticada. Ningún manifiesto de una sola orden se genera automáticamente ni desde esta pantalla pública, y el envío real permanece siempre bloqueado.</p>
    <a href="/pilot" class="badge" style="margin-top:12px;text-decoration:none;display:inline-block">Abrir consola privada del piloto →</a>
  </section>

  <div class="section-title">Historial de operaciones</div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  const DECISION_OUTCOME_LABELS={'buy-executed':'Compra ejecutada','sell-executed':'Venta ejecutada','hold':'Mantener','risk-blocked':'Bloqueada por riesgo','cooldown-blocked':'Bloqueada por enfriamiento','execution-blocked':'Bloqueada en ejecución','stop-loss-executed':'Stop loss ejecutado','take-profit-executed':'Take profit ejecutado'};
  function renderDecisionTimeline(data){
    const entries=Array.isArray(data&&data.entries)?data.entries:[];
    const stats=data&&data.stats?data.stats:null;
    document.getElementById('decisionTimelineStats').innerHTML=stats?[
      ['Señales de compra',stats.rawBuySignals||0],
      ['Señales de venta',stats.rawSellSignals||0],
      ['Señales de mantener',stats.rawHoldSignals||0],
      ['Bloqueadas por riesgo',stats.riskBlocks||0]
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong>'+escapeHtml(item[1])+'</strong></div>'}).join(''):'';
    const status=document.getElementById('decisionTimelineStatus');const list=document.getElementById('decisionTimelineList');
    if(!entries.length){status.textContent='Todavía no hay señales registradas en el motor principal.';list.innerHTML='';return}
    status.textContent='Mostrando las '+Math.min(entries.length,40)+' señales más recientes de '+entries.length+' registradas (máx. 500 conservadas).';
    list.innerHTML=entries.slice(0,40).map(function(entry){
      const label=DECISION_OUTCOME_LABELS[entry.outcome]||String(entry.outcome||'—');
      const signalClass=entry.rawSignal==='buy'?'buy':entry.rawSignal==='sell'?'sell':'';
      return '<div class="timeline-entry"><div class="between"><strong>'+time(entry.candleTime)+'</strong><span class="badge '+signalClass+'">'+escapeHtml(label)+'</span></div><div class="meta">Señal bruta: '+escapeHtml(entry.rawSignal)+' · '+escapeHtml(entry.rawReason)+'</div><div class="meta">'+escapeHtml(entry.finalReason)+'</div><div class="meta">Precio '+money(entry.price)+' · Equity '+money(entry.equityEur)+'</div></div>';
    }).join('');
  }
  let decisionTimelineLoading=false;
  async function loadDecisionTimeline(){
    if(decisionTimelineLoading)return;decisionTimelineLoading=true;
    try{
      const response=await fetch('/api/decisions',{cache:'no-store'});
      if(!response.ok)throw new Error('decisions unavailable');
      renderDecisionTimeline(await response.json());
    }catch(e){
      document.getElementById('decisionTimelineStatus').textContent='No se pudo cargar la cronología de decisiones. Se reintentará automáticamente.';
    }finally{
      decisionTimelineLoading=false;
    }
  }
  function renderCommitteeVoteDetail(lab){
    const report=lab&&lab.committeeImpact?lab.committeeImpact:null;
    const wrap=document.getElementById('committeeVoteDetail');
    const entries=report&&Array.isArray(report.recentEntries)?report.recentEntries:[];
    if(!entries.length){wrap.innerHTML='<div class="empty-state">Sin operaciones evaluadas todavía por el comité.</div>';return}
    wrap.innerHTML=entries.slice(0,6).map(function(entry){
      const votes=Array.isArray(entry.votes)?entry.votes:[];
      const votesHtml=votes.length?votes.map(function(vote){
        const icon=vote.vote==='approve'?'✓':vote.vote==='veto'?'✕':'○';
        return '<div class="vote '+escapeHtml(vote.vote)+'"><div class="between"><strong>'+icon+' '+escapeHtml(vote.role)+'</strong><span class="badge">'+escapeHtml(vote.vote)+'</span></div><div class="reason">'+escapeHtml(vote.reason)+'</div></div>';
      }).join(''):'<div class="empty-state">Sin votos individuales conservados para esta operación.</div>';
      const result=entry.outcome==='open'?'Abierta':money(entry.pnlEur||0);
      return '<details class="vote-detail"><summary>'+escapeHtml(humanMarket(entry.symbol))+' · '+time(entry.entryAt)+' · '+escapeHtml(entry.verdict)+' · Resultado '+escapeHtml(result)+'</summary><div class="committee-grid" style="margin-top:9px">'+votesHtml+'</div></details>';
    }).join('');
  }
  function renderPilotInfo(readiness){
    const eligible=readiness&&readiness.eligibleForLiveReview===true;
    document.getElementById('pilotInfoStatus').innerHTML='<span class="'+(eligible?'positive':'neutral')+'">'+(eligible?'La evidencia PAPER de arriba ya cumple los mínimos definidos para una futura revisión humana de piloto.':'La evidencia PAPER de arriba todavía no cumple todos los mínimos definidos para una futura revisión de piloto.')+'</span>';
  }
`,
  );

  html = replaceRequired(
    html,
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderPaperEvidence(lab);renderStress(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo);renderFrozenForward(lab);renderCapitalCurve(lab,demo);renderPerformanceSummary(lab,demo);renderPositionsOverview(lab);renderExecutionQualityGate(demo)}",
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderPaperEvidence(lab);renderStress(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo);renderFrozenForward(lab);renderCapitalCurve(lab,demo);renderPerformanceSummary(lab,demo);renderPositionsOverview(lab);renderExecutionQualityGate(demo);renderCommitteeVoteDetail(lab)}",
  );

  html = replaceRequired(
    html,
    "renderActivity(lab,demo);renderAdvanced(lab,demo);document.getElementById('raw').textContent=JSON.stringify({shadowLiveDemo:demo,readiness:readiness,marketUniverse:markets,committee:lab.committee,committeeImpact:lab.committeeImpact,paperEvidenceLedger:lab.paperEvidenceLedger,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite,frozenForwardExperiment:lab.frozenForwardExperiment,frozenForwardStatus:lab.frozenForwardStatus},null,2);",
    "renderActivity(lab,demo);renderAdvanced(lab,demo);renderPilotInfo(readiness);document.getElementById('raw').textContent=JSON.stringify({shadowLiveDemo:demo,readiness:readiness,marketUniverse:markets,committee:lab.committee,committeeImpact:lab.committeeImpact,paperEvidenceLedger:lab.paperEvidenceLedger,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite,frozenForwardExperiment:lab.frozenForwardExperiment,frozenForwardStatus:lab.frozenForwardStatus},null,2);",
  );

  html = replaceRequired(
    html,
    "loadDemo(false);setInterval(function(){loadDemo(false)},15000);",
    "loadDemo(false);setInterval(function(){loadDemo(false)},15000);loadDecisionTimeline();setInterval(loadDecisionTimeline,15000);",
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
