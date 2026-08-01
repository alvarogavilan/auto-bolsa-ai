import { temporalDemoDashboard } from "./demo-dashboard-temporal";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_STRESS_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

export async function stressDemoDashboard(): Promise<Response> {
  const base = await temporalDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.stress-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.stress-scenarios{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:12px}.stress-card{padding:13px;border:1px solid #29415f;background:#0b192b;border-radius:15px}.stress-card.profitable{border-color:rgba(73,221,161,.35)}.stress-card.unprofitable{border-color:rgba(255,124,136,.45)}.stress-card .scenario-title{font-weight:850}.stress-card .scenario-meta{font-size:11px;color:var(--muted);margin-top:5px}.stress-card .scenario-result{font-size:18px;font-weight:850;margin-top:9px}.stress-list{margin:10px 0 0;padding-left:18px;color:#c5d5e9;font-size:12px;line-height:1.5}@media(max-width:720px){.stress-grid,.stress-scenarios{grid-template-columns:repeat(2,1fr)}}@media(max-width:440px){.stress-grid,.stress-scenarios{grid-template-columns:1fr}}</style>`,
  );

  html = replaceRequired(
    html,
    '  <div class="section-title">Validación temporal</div>',
    `  <div class="section-title">Pruebas de estrés</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">¿Sobrevive a costes peores?</h2><div class="muted" style="font-size:12px;margin-top:5px">Recalcula operaciones con comisiones superiores, relleno adverso y secuencias de pérdidas.</div></div><span id="stressVerdict" class="badge">Calculando</span></div>
    <div id="stressSummary" class="stress-grid" style="margin-top:12px"></div>
    <div id="stressScenarios" class="stress-scenarios"></div>
    <div id="stressMessage" class="status-message" style="margin-top:12px">Esperando ciclos compra-venta.</div>
    <div id="stressDetails"></div>
  </section>

  <div class="section-title">Validación temporal</div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function stressPf(scenario){
    if(!scenario)return '—';
    if(scenario.profitFactorNoLosses)return 'Sin pérdidas';
    return scenario.profitFactor===null||scenario.profitFactor===undefined?'—':Number(scenario.profitFactor).toFixed(2).replace('.',',');
  }
  function selectedStress(lab,demo){
    const report=lab&&lab.costSequenceStress?lab.costSequenceStress:null;
    const entries=Array.isArray(report&&report.entries)?report.entries:[];
    const selected=demo&&demo.selectedStrategy?demo.selectedStrategy.id:null;
    return {report:report,entry:entries.find(function(item){return item.strategyId===selected})||(Array.isArray(report&&report.leaderboard)?report.leaderboard[0]:null)||entries[0]||null};
  }
  function renderStress(lab,demo){
    const selected=selectedStress(lab,demo);const report=selected.report;const entry=selected.entry;
    const verdict=document.getElementById('stressVerdict');const summary=document.getElementById('stressSummary');
    const scenarios=document.getElementById('stressScenarios');const message=document.getElementById('stressMessage');const details=document.getElementById('stressDetails');
    if(!report||!entry){verdict.textContent='Inicializando';summary.innerHTML='<div class="empty-state">Todavía no hay ciclos compra-venta evaluables.</div>';scenarios.innerHTML='';message.textContent='Las pruebas comenzarán cuando el historial contenga compras y ventas emparejadas.';details.innerHTML='';return}
    const labels={insufficient:'Muestra insuficiente',fragile:'Frágil',developing:'En desarrollo',resilient_candidate:'Candidata resiliente'};
    verdict.textContent=labels[entry.verdict]||entry.verdict;
    const combined=entry.combinedScenario||{};
    summary.innerHTML=[
      ['Estrategias con muestra',report.sufficientlySampledStrategies+'/'+report.strategyCount],
      ['Candidatas resilientes',report.resilientCandidates],
      ['Frágiles',report.fragileStrategies],
      ['Ciclos emparejados',entry.closedRoundTrips],
      ['Resultado combinado',money(combined.netPnlEur||0)],
      ['Drawdown combinado',Number((combined.maxDrawdownPct||0)*100).toFixed(2).replace('.',',')+' %'],
      ['Racha perdedora',combined.longestLosingStreak||0],
      ['Peor bloque de 5',money(combined.worstFiveTradePnlEur||0)]
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong>'+escapeHtml(item[1])+'</strong></div>'}).join('');
    const items=Array.isArray(entry.scenarios)?entry.scenarios:[];
    scenarios.innerHTML=items.map(function(item){return '<div class="stress-card '+(item.profitable?'profitable':'unprofitable')+'"><div class="scenario-title">'+escapeHtml(item.label)+'</div><div class="scenario-meta">PF '+escapeHtml(stressPf(item))+' · Win rate '+(item.winRatePct===null?'—':Number(item.winRatePct).toFixed(1).replace('.',',')+' %')+'</div><div class="scenario-result '+pnlClass(item.netPnlEur)+'">'+money(item.netPnlEur)+'</div><div class="scenario-meta">Drawdown '+Number(item.maxDrawdownPct*100).toFixed(2).replace('.',',')+' % · Racha '+item.longestLosingStreak+'</div></div>'}).join('');
    message.textContent=entry.interpretation+' Esta prueba no cambia operaciones ni habilita LIVE.';
    const blockers=Array.isArray(entry.blockers)?entry.blockers:[];const warnings=Array.isArray(entry.warnings)?entry.warnings:[];
    details.innerHTML=(blockers.length?'<div style="margin-top:12px"><strong>Bloqueos</strong><ul class="stress-list">'+blockers.map(function(item){return '<li>'+escapeHtml(item)+'</li>'}).join('')+'</ul></div>':'')+(warnings.length?'<div style="margin-top:12px"><strong>Avisos</strong><ul class="stress-list">'+warnings.map(function(item){return '<li>'+escapeHtml(item)+'</li>'}).join('')+'</ul></div>':'');
  }
`,
  );

  html = replaceRequired(
    html,
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo)}",
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderStress(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo)}",
  );

  html = replaceRequired(
    html,
    "committeeImpact:lab.committeeImpact,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite",
    "committeeImpact:lab.committeeImpact,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite",
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
