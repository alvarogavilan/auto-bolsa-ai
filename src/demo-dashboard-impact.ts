import { enhancedDemoDashboard } from "./demo-dashboard-enhanced";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_IMPACT_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

export async function impactDemoDashboard(): Promise<Response> {
  const base = await enhancedDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.impact-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.impact-list{display:grid;gap:8px;margin-top:12px}.impact-entry{padding:12px;border:1px solid #29415f;background:#0b192b;border-radius:14px}.impact-entry .meta{font-size:11px;color:var(--muted);margin-top:5px}.impact-entry .result{font-size:13px;font-weight:800;margin-top:7px}@media(max-width:720px){.impact-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:440px){.impact-grid{grid-template-columns:1fr}}</style>`,
  );

  html = replaceRequired(
    html,
    '  <div class="section-title">Comparación exigente</div>',
    `  <div class="section-title">Impacto medido del comité</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">¿Habrían servido sus vetos?</h2><div class="muted" style="font-size:12px;margin-top:5px">Asocia el voto del mismo ciclo a cada compra DEMO y evalúa el resultado cuando se cierra.</div></div><span id="impactAuthority" class="badge">Solo shadow</span></div>
    <div id="impactMetrics" class="impact-grid" style="margin-top:12px"></div>
    <div id="impactInterpretation" class="status-message" style="margin-top:12px">Esperando operaciones evaluables.</div>
    <div id="impactEntries" class="impact-list"></div>
  </section>

  <div class="section-title">Comparación exigente</div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function renderCommitteeImpact(lab){
    const report=lab&&lab.committeeImpact?lab.committeeImpact:null;
    const metrics=document.getElementById('impactMetrics');
    const interpretation=document.getElementById('impactInterpretation');
    const entries=document.getElementById('impactEntries');
    document.getElementById('impactAuthority').textContent='Autoridad: desactivada';
    if(!report){
      metrics.innerHTML='<div class="empty-state">El ledger se inicializará en el próximo ciclo del laboratorio.</div>';
      interpretation.textContent='El comité no cambia operaciones y todavía no tiene una muestra causal.';
      entries.innerHTML='';
      return;
    }
    const net=Number(report.hypotheticalHardVetoNetBenefitEur||0);
    const values=[
      ['Entradas observadas',report.entriesObserved??0],
      ['Operaciones cerradas',report.closedEntries??0],
      ['Pérdidas evitables',money(report.hardVetoLossesAvoidedEur||0)],
      ['Ganancias rechazadas',money(report.hardVetoGainsMissedEur||0)],
      ['Balance hipotético',money(net)],
      ['Veto duro cerrado',report.hardVetoClosedEntries??0],
      ['Candidatas cerradas',report.candidateClosedEntries??0],
      ['Salidas sin entrada',report.unmatchedExitTrades??0]
    ];
    metrics.innerHTML=values.map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong class="'+(item[0]==='Balance hipotético'?pnlClass(net):'')+'">'+escapeHtml(item[1])+'</strong></div>'}).join('');
    interpretation.textContent=String(report.interpretation||'El comité permanece en shadow.')+' La autoridad automática sigue desactivada.';
    const recent=Array.isArray(report.recentEntries)?report.recentEntries.slice(0,8):[];
    entries.innerHTML=recent.length?recent.map(function(entry){
      const result=entry.outcome==='open'?'Abierta':money(entry.pnlEur||0);
      return '<div class="impact-entry"><div class="between"><strong>'+escapeHtml(humanMarket(entry.symbol))+' · '+lane(entry.lane)+'</strong><span class="badge">'+escapeHtml(entry.verdict)+'</span></div><div class="meta">Entrada '+time(entry.entryAt)+' · '+entry.hardVetoCount+' veto(s) duro(s) · '+entry.approvals+' aprobación(es)</div><div class="result '+pnlClass(entry.pnlEur)+'">Resultado: '+escapeHtml(result)+'</div></div>';
    }).join(''):'<div class="empty-state"><strong>Sin entradas nuevas asociadas</strong>El próximo ciclo incorporará el historial DEMO retenido y después cada nueva operación.</div>';
  }
`,
  );

  html = replaceRequired(
    html,
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderBenchmarkSuite(lab,demo)}",
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo)}",
  );

  html = replaceRequired(
    html,
    "committee:lab.committee,benchmarkSuite:lab.benchmarkSuite",
    "committee:lab.committee,committeeImpact:lab.committeeImpact,benchmarkSuite:lab.benchmarkSuite",
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
