import { authenticatedPilotDashboard } from "./pilot-dashboard-access";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`PILOT_FIRE_DRILL_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

export async function fireDrillPilotDashboard(): Promise<Response> {
  const base = await authenticatedPilotDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    '<div id="error" class="error"></div>',
    `<section class="validation-card">
      <div class="between"><div><strong>Simulacro integral de seguridad</strong><div class="action-status">Ensaya el camino completo con transporte simulado y estado efímero.</div></div><span id="fireDrillBadge" class="badge">Pendiente</span></div>
      <div class="phase-note">No usa credenciales, no contacta con Kraken, no persiste estado y no puede crear una orden real.</div>
      <div class="validation-actions"><button id="fireDrillButton" class="small secondary" onclick="runPilotFireDrillFromApp()">Ejecutar 6 pruebas de seguridad</button></div>
      <div id="fireDrillStatus" class="action-status">El informe de preparación las ejecutará automáticamente.</div>
      <div id="fireDrillChecks" class="list" style="margin-top:10px"></div>
    </section>

    <div id="error" class="error"></div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function renderPilotFireDrill(report){
    const badge=document.getElementById('fireDrillBadge');
    const status=document.getElementById('fireDrillStatus');
    const checks=document.getElementById('fireDrillChecks');
    const items=Array.isArray(report&&report.checks)?report.checks:[];
    badge.textContent=report&&report.passed===true?'6/6 superadas':(report&&Number.isFinite(Number(report.passedChecks))?String(report.passedChecks)+'/'+String(report.totalChecks):'Pendiente');
    status.textContent=report&&report.passed===true
      ?'Simulacro completo: todas las barreras fallaron cerrado. No se contactó con Kraken.'
      :report?'El simulacro detectó al menos una protección no demostrada. El piloto real debe seguir bloqueado.':'Esperando el informe automático de seguridad.';
    checks.innerHTML=items.map(function(item){
      return '<div class="item '+(item.passed?'passed':'blocker')+'"><strong>'+(item.passed?'✓ ':'✗ ')+escapeHtml(item.title)+'</strong><div style="margin-top:4px">'+escapeHtml(item.detail)+'</div></div>';
    }).join('');
  }
  async function runPilotFireDrillFromApp(){
    const button=document.getElementById('fireDrillButton');
    button.disabled=true;
    document.getElementById('fireDrillStatus').textContent='Ejecutando escenarios locales y efímeros…';
    document.getElementById('fireDrillChecks').innerHTML='';
    try{
      const report=await authenticatedPilotPost('/api/pilot/fire-drill');
      renderPilotFireDrill(report);
    }catch(e){
      document.getElementById('fireDrillBadge').textContent='Bloqueado';
      document.getElementById('fireDrillStatus').textContent='No se pudo completar el simulacro: '+String(e&&e.message?e.message:e);
    }finally{button.disabled=false}
  }
`,
  );

  html = replaceRequired(
    html,
    "    renderEmergency(data);\n    document.getElementById('raw').textContent=JSON.stringify(data,null,2);",
    "    renderEmergency(data);\n    renderPilotFireDrill(data.fireDrill);\n    document.getElementById('raw').textContent=JSON.stringify(data,null,2);",
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
