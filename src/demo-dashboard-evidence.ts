import { forwardDemoDashboard } from "./demo-dashboard-forward";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_EVIDENCE_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

export async function evidenceDemoDashboard(): Promise<Response> {
  const base = await forwardDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.evidence-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px}.evidence-list{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:12px}.evidence-item{padding:13px;border:1px solid #29415f;background:#0b192b;border-radius:15px}.evidence-item .meta{font-size:11px;color:var(--muted);margin-top:5px}.evidence-health{padding:10px 12px;border-radius:12px;font-size:12px;margin-top:12px}.evidence-health.ok{background:rgba(73,221,161,.09);border:1px solid rgba(73,221,161,.3);color:#baf5dc}.evidence-health.error{background:rgba(255,124,136,.1);border:1px solid rgba(255,124,136,.35);color:#ffd0d5}@media(max-width:720px){.evidence-grid,.evidence-list{grid-template-columns:repeat(2,1fr)}}@media(max-width:440px){.evidence-grid,.evidence-list{grid-template-columns:1fr}}</style>`,
  );

  html = replaceRequired(
    html,
    '  <div class="section-title">Pruebas de estrés</div>',
    `  <div class="section-title">Archivo de evidencia PAPER</div>
  <section class="card">
    <div class="between"><div><h2 style="margin:0">Historial persistente</h2><div class="muted" style="font-size:12px;margin-top:5px">Conserva operaciones aunque la lista visible se recorte. No modifica ninguna decisión.</div></div><span id="evidenceBadge" class="badge">Cargando</span></div>
    <div id="evidenceSummary" class="evidence-grid" style="margin-top:12px"></div>
    <div id="evidenceHealth"></div>
    <div id="evidenceStrategies" class="evidence-list"></div>
  </section>

  <div class="section-title">Pruebas de estrés</div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function renderPaperEvidence(lab){
    const report=lab&&lab.paperEvidenceLedger?lab.paperEvidenceLedger:null;
    const status=lab&&lab.paperEvidenceLedgerStatus?lab.paperEvidenceLedgerStatus:null;
    const badge=document.getElementById('evidenceBadge');const summary=document.getElementById('evidenceSummary');
    const health=document.getElementById('evidenceHealth');const strategies=document.getElementById('evidenceStrategies');
    if(!report){badge.textContent='Inicializando';summary.innerHTML='<div class="empty-state">El archivo se inicializará con el próximo ciclo PAPER.</div>';health.innerHTML='';strategies.innerHTML='';return}
    badge.textContent=(status&&status.available===false)?'Archivo degradado':'Archivo activo';
    summary.innerHTML=[
      ['Movimientos retenidos',report.totalMovements||0],
      ['Operaciones cerradas',report.closedTrades||0],
      ['Compras / ventas',(report.buys||0)+' / '+(report.sells||0)],
      ['Estrategias archivadas',report.strategyCount||0],
      ['Primera evidencia',report.earliestTradeAt?time(report.earliestTradeAt):'Pendiente'],
      ['Última evidencia',report.latestTradeAt?time(report.latestTradeAt):'Pendiente'],
      ['Máximo por estrategia',report.maxMovementsPerStrategy||1000],
      ['Influye en trading','No']
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong>'+escapeHtml(item[1])+'</strong></div>'}).join('');
    const healthy=!status||status.available!==false;
    health.innerHTML='<div class="evidence-health '+(healthy?'ok':'error')+'">'+(healthy?'✓ Evidencia disponible para validación temporal y pruebas de estrés.':'El archivo persistente no está disponible en este ciclo. PAPER continúa funcionando porque esta capa es fail-open.')+'</div>';
    const items=Array.isArray(report.strategies)?report.strategies.slice(0,12):[];
    strategies.innerHTML=items.length?items.map(function(item){return '<div class="evidence-item"><div class="between"><strong>'+escapeHtml(humanMarket(item.symbol))+' · '+lane(item.lane)+'</strong><span class="badge">'+escapeHtml(item.closedTrades)+' cerradas</span></div><div class="meta">'+escapeHtml(item.movements)+' movimientos · '+escapeHtml(item.buys)+' compras · '+escapeHtml(item.sells)+' ventas</div><div class="meta">Desde '+(item.earliestTradeAt?time(item.earliestTradeAt):'—')+' hasta '+(item.latestTradeAt?time(item.latestTradeAt):'—')+'</div></div>'}).join(''):'<div class="empty-state"><strong>Aún sin operaciones archivadas</strong>El sistema ya está preparado para conservar las próximas.</div>';
  }
`,
  );

  html = replaceRequired(
    html,
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderStress(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo);renderFrozenForward(lab)}",
    "function renderAdvanced(lab,demo){renderSystemActivity(lab);renderCommittee(lab,demo);renderPaperEvidence(lab);renderStress(lab,demo);renderTemporalValidation(lab,demo);renderCommitteeImpact(lab);renderBenchmarkSuite(lab,demo);renderFrozenForward(lab)}",
  );

  html = replaceRequired(
    html,
    "committeeImpact:lab.committeeImpact,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite,frozenForwardExperiment:lab.frozenForwardExperiment,frozenForwardStatus:lab.frozenForwardStatus",
    "committeeImpact:lab.committeeImpact,paperEvidenceLedger:lab.paperEvidenceLedger,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite,frozenForwardExperiment:lab.frozenForwardExperiment,frozenForwardStatus:lab.frozenForwardStatus",
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
