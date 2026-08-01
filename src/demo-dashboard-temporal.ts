import { impactDemoDashboard } from "./demo-dashboard-impact";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_TEMPORAL_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

export async function temporalDemoDashboard(): Promise<Response> {
  const base = await impactDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.temporal-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.temporal-panels{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-top:12px}.temporal-panel{padding:14px;border:1px solid #29415f;background:#0b192b;border-radius:15px}.temporal-panel h3{margin:0 0 10px}.fold-row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px}.fold{padding:10px;border-radius:12px;background:#0c1a2d;border:1px solid #203a5a}.fold.positive{border-color:rgba(73,221,161,.4)}.fold.negative{border-color:rgba(255,124,136,.4)}.temporal-list{margin:10px 0 0;padding-left:18px;color:#c5d5e9;font-size:12px;line-height:1.5}@media(max-width:720px){.temporal-grid{grid-template-columns:repeat(2,1fr)}.temporal-panels{grid-template-columns:1fr}}@media(max-width:440px){.temporal-grid,.fold-row{grid-template-columns:1fr}}</style>`,
  );

  html = replaceRequired(
    html,
    '  <div class="section-title">Impacto medido del comité</div>',
    `  <div class="section-title">Validación temporal</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">¿Se mantiene fuera del tramo inicial?</h2><div class="muted" style="font-size:12px;margin-top:5px">Divide cronológicamente las operaciones: 60 % inicial, 40 % posterior y tres bloques temporales.</div></div><span id="temporalVerdict" class="badge">Calculando</span></div>
    <div id="temporalSummary" class="temporal-grid" style="margin-top:12px"></div>
    <div id="temporalPanels" class="temporal-panels"></div>
    <div id="temporalFolds" class="fold-row"></div>
    <div id="temporalMessage" class="status-message" style="margin-top:12px">Esperando muestra cerrada.</div>
    <div id="temporalDetails"></div>
  </section>

  <div class="section-title">Impacto medido del comité</div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function temporalPf(metrics){
    if(!metrics)return '—';
    if(metrics.profitFactorNoLosses)return 'Sin pérdidas';
    return metrics.profitFactor===null||metrics.profitFactor===undefined?'—':Number(metrics.profitFactor).toFixed(2).replace('.',',');
  }
  function selectedTemporal(lab,demo){
    const report=lab&&lab.temporalValidation?lab.temporalValidation:null;
    const entries=Array.isArray(report&&report.entries)?report.entries:[];
    const selected=demo&&demo.selectedStrategy?demo.selectedStrategy.id:null;
    return {report:report,entry:entries.find(function(item){return item.strategyId===selected})||(Array.isArray(report&&report.leaderboard)?report.leaderboard[0]:null)||entries[0]||null};
  }
  function renderTemporalValidation(lab,demo){
    const selected=selectedTemporal(lab,demo);const report=selected.report;const entry=selected.entry;
    const verdict=document.getElementById('temporalVerdict');const summary=document.getElementById('temporalSummary');
    const panels=document.getElementById('temporalPanels');const folds=document.getElementById('temporalFolds');
    const message=document.getElementById('temporalMessage');const details=document.getElementById('temporalDetails');
    if(!report||!entry){verdict.textContent='Inicializando';summary.innerHTML='<div class="empty-state">Todavía no hay estrategias evaluables.</div>';panels.innerHTML='';folds.innerHTML='';message.textContent='La validación temporal aparecerá cuando existan operaciones cerradas.';details.innerHTML='';return}
    const labels={insufficient:'Muestra insuficiente',unstable:'Inestable',developing:'En desarrollo',robust_candidate:'Candidata robusta'};
    verdict.textContent=labels[entry.verdict]||entry.verdict;
    summary.innerHTML=[
      ['Estrategias con muestra',report.sufficientlySampledStrategies+'/'+report.strategyCount],
      ['Candidatas robustas',report.robustCandidates],
      ['En desarrollo',report.developingStrategies],
      ['Inestables',report.unstableStrategies],
      ['Estrategia mostrada',humanMarket(entry.symbol)],
      ['Operaciones cerradas',entry.totalClosedTrades],
      ['Puntuación estabilidad',entry.stabilityScore+' / 100'],
      ['Bloques positivos',entry.positiveRollingFolds+' / '+entry.evaluatedRollingFolds]
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong>'+escapeHtml(item[1])+'</strong></div>'}).join('');
    function panel(title,m){return '<div class="temporal-panel"><h3>'+title+'</h3><div class="position-grid">'+
      '<div class="mini"><span>Operaciones</span><strong>'+escapeHtml(m.trades)+'</strong></div>'+
      '<div class="mini"><span>Resultado</span><strong class="'+pnlClass(m.netPnlEur)+'">'+money(m.netPnlEur)+'</strong></div>'+
      '<div class="mini"><span>Profit factor</span><strong>'+escapeHtml(temporalPf(m))+'</strong></div>'+
      '<div class="mini"><span>Win rate</span><strong>'+(m.winRatePct===null?'—':Number(m.winRatePct).toFixed(1).replace('.',',')+' %')+'</strong></div>'+
      '<div class="mini"><span>Media por operación</span><strong class="'+pnlClass(m.averagePnlEur)+'">'+money(m.averagePnlEur)+'</strong></div>'+
      '<div class="mini"><span>Concentración mejor ganancia</span><strong>'+(m.positivePnlConcentrationPct===null?'—':Number(m.positivePnlConcentrationPct).toFixed(1).replace('.',',')+' %')+'</strong></div>'+
      '</div></div>'}
    panels.innerHTML=panel('60 % inicial',entry.training)+panel('40 % posterior',entry.validation);
    const rolling=Array.isArray(entry.rollingFolds)?entry.rollingFolds:[];
    folds.innerHTML=rolling.map(function(fold){return '<div class="fold '+(fold.positive?'positive':'negative')+'"><strong>'+escapeHtml(fold.label)+'</strong><div class="muted" style="font-size:11px;margin-top:5px">'+fold.metrics.trades+' operaciones</div><div class="'+pnlClass(fold.metrics.netPnlEur)+'" style="font-weight:850;margin-top:6px">'+money(fold.metrics.netPnlEur)+'</div></div>'}).join('');
    message.textContent=entry.interpretation+' Esta capa no cambia operaciones ni habilita dinero real.';
    const blockers=Array.isArray(entry.blockers)?entry.blockers:[];const warnings=Array.isArray(entry.warnings)?entry.warnings:[];
    details.innerHTML=(blockers.length?'<div style="margin-top:12px"><strong>Bloqueos</strong><ul class="temporal-list">'+blockers.map(function(item){return '<li>'+escapeHtml(item)+'</li>'}).join('')+'</ul></div>':'')+(warnings.length?'<div style="margin-top:12px"><strong>Avisos</strong><ul class="temporal-list">'+warnings.map(function(item){return '<li>'+escapeHtml(item)+'</li>'}).join('')+'</ul></div>':'');
  }
`,
  );

  html = replaceRequired(
    html,
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo)}",
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo)}",
  );

  html = replaceRequired(
    html,
    "committeeImpact:lab.committeeImpact,benchmarkSuite:lab.benchmarkSuite",
    "committeeImpact:lab.committeeImpact,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite",
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
