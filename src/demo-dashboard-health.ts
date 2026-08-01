import { timelineDemoDashboard } from "./demo-dashboard-timeline";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`DEMO_HEALTH_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

/**
 * Añade un indicador único de salud del sistema, arriba del todo, que resume
 * en un vistazo señales que ya se calculan por separado en el resto del
 * panel (frescura del universo de mercados, frescura del ciclo del
 * laboratorio, tasa de error del motor principal, estado de cada
 * estrategia). No añade ninguna llamada nueva ni cambia ningún umbral de
 * riesgo: solo lee y resume datos que ya viajan en `/api/lab` y
 * `/api/readiness`.
 */
export async function healthDemoDashboard(): Promise<Response> {
  const base = await timelineDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.health-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:9px;margin-top:12px}@media(max-width:440px){.health-grid{grid-template-columns:1fr}}.health-verdict.ok{background:rgba(73,221,161,.14);color:var(--green);border-color:rgba(73,221,161,.4)}.health-verdict.warn{background:rgba(255,209,102,.14);color:var(--amber);border-color:rgba(255,209,102,.4)}.health-verdict.bad{background:rgba(255,124,136,.14);color:var(--red);border-color:rgba(255,124,136,.4)}</style>`,
  );

  html = replaceRequired(
    html,
    '  <div id="error" class="error"></div>',
    `  <div id="error" class="error"></div>

  <section class="card">
    <div class="between"><div><h2 style="margin:0">Salud del sistema</h2><div class="muted" style="font-size:12px;margin-top:5px">Resumen de las mismas señales que se detallan más abajo, en un solo vistazo.</div></div><span id="healthVerdict" class="badge health-verdict">Calculando</span></div>
    <div id="healthGrid" class="health-grid"></div>
  </section>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function renderSystemHealth(lab,readiness,markets){
    const badge=document.getElementById('healthVerdict');const grid=document.getElementById('healthGrid');
    const state=lab&&lab.state?lab.state:{};const strategies=Array.isArray(state.strategies)?state.strategies:[];
    const lastCycle=Number(state.lastCycleAt);const labStale=!Number.isFinite(lastCycle)||(Date.now()-lastCycle)>15*60*1000;
    const marketOk=Boolean(markets)&&markets.available!==false;
    const errorRateOk=!readiness||!readiness.checks||readiness.checks.errorRateAccepted!==false;
    const activeCount=strategies.filter(function(s){return s.status==='active'}).length;
    const haltedCount=strategies.filter(function(s){return s.status==='halted'}).length;
    const erroredCount=strategies.filter(function(s){return s.status==='error'}).length;
    const bad=!marketOk||labStale||!errorRateOk||erroredCount>0;
    const warn=!bad&&haltedCount>0;
    badge.className='badge health-verdict '+(bad?'bad':warn?'warn':'ok');
    badge.textContent=bad?'Con incidencias':warn?'Parcialmente operativo':'Todo operativo';
    grid.innerHTML=[
      ['Mercado Kraken',marketOk?'Operativo':'Sin datos recientes'+(markets&&markets.error?' ('+markets.error+')':'')],
      ['Ciclo del laboratorio',labStale?'Sin ciclo en los últimos 15 min':'Reciente'],
      ['Motor principal (errores)',readiness?(readiness.successfulTickAttempts||0)+' correctos / '+(readiness.errorsObserved||0)+' con error':'—'],
      ['Estrategias',activeCount+' activas · '+haltedCount+' detenidas · '+erroredCount+' con error']
    ].map(function(item){return '<div class="mini"><span>'+escapeHtml(item[0])+'</span><strong>'+escapeHtml(item[1])+'</strong></div>'}).join('');
  }
`,
  );

  html = replaceRequired(
    html,
    "renderActivity(lab,demo);renderAdvanced(lab,demo);renderPilotInfo(readiness);document.getElementById('raw').textContent=JSON.stringify({shadowLiveDemo:demo,readiness:readiness,marketUniverse:markets,committee:lab.committee,committeeImpact:lab.committeeImpact,paperEvidenceLedger:lab.paperEvidenceLedger,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite,frozenForwardExperiment:lab.frozenForwardExperiment,frozenForwardStatus:lab.frozenForwardStatus},null,2);",
    "renderActivity(lab,demo);renderAdvanced(lab,demo);renderPilotInfo(readiness);renderSystemHealth(lab,readiness,markets);document.getElementById('raw').textContent=JSON.stringify({shadowLiveDemo:demo,readiness:readiness,marketUniverse:markets,committee:lab.committee,committeeImpact:lab.committeeImpact,paperEvidenceLedger:lab.paperEvidenceLedger,costSequenceStress:lab.costSequenceStress,temporalValidation:lab.temporalValidation,benchmarkSuite:lab.benchmarkSuite,frozenForwardExperiment:lab.frozenForwardExperiment,frozenForwardStatus:lab.frozenForwardStatus},null,2);",
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
