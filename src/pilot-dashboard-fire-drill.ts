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
      <div class="between"><div><strong>Limpieza de la cuenta Kraken</strong><div class="action-status">Comprueba que el baseline comienza sin inventario ni órdenes anteriores.</div></div><span id="accountCleanBadge" class="badge">Pendiente</span></div>
      <div class="grid3" style="margin-top:10px">
        <div class="mini"><span>Saldo EUR</span><strong id="accountCleanEur">—</strong></div>
        <div class="mini"><span>Activos no EUR</span><strong id="accountCleanAssets">—</strong></div>
        <div class="mini"><span>Órdenes abiertas</span><strong id="accountCleanOrders">—</strong></div>
      </div>
      <div class="validation-actions" style="margin-top:10px"><button id="accountAuditButton" class="small secondary" onclick="runPilotAccountAuditFromApp()">Revisar cuenta ahora</button></div>
      <div id="accountCleanStatus" class="action-status">Lectura privada pendiente. Nunca crea, cancela ni modifica órdenes.</div>
    </section>

    <section class="validation-card">
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
  function renderPilotAccountCleanliness(audit){
    const badge=document.getElementById('accountCleanBadge');
    const status=document.getElementById('accountCleanStatus');
    const available=Boolean(audit&&audit.available!==false&&audit.schemaVersion==='kraken-account-cleanliness-v1');
    const clean=available&&audit.accountCleanForBaseline===true;
    badge.textContent=clean?'Cuenta limpia':available?'Bloqueada':'Pendiente';
    document.getElementById('accountCleanEur').textContent=available&&audit.eurBalance!==null&&audit.eurBalance!==undefined?money(audit.eurBalance):'No disponible';
    document.getElementById('accountCleanAssets').textContent=available&&Number.isFinite(Number(audit.nonEurAssetCount))?String(audit.nonEurAssetCount):'—';
    document.getElementById('accountCleanOrders').textContent=available&&Number.isFinite(Number(audit.openOrderCount))?String(audit.openOrderCount):'—';
    if(clean){status.textContent='Cuenta limpia para establecer el baseline: sin activos no EUR ni órdenes abiertas.';return}
    if(available){const blockers=Array.isArray(audit.blockers)?audit.blockers:[];status.textContent=blockers.length?blockers.join(' · '):'La cuenta no cumple las condiciones del baseline.';return}
    status.textContent=audit&&audit.error?'Auditoría no disponible: '+audit.error:'Esperando la auditoría privada de la cuenta.';
  }
  async function runPilotAccountAuditFromApp(){
    const button=document.getElementById('accountAuditButton');
    button.disabled=true;
    document.getElementById('accountCleanStatus').textContent='Consultando saldo y órdenes abiertas de forma secuencial…';
    try{
      const audit=await authenticatedPilotPost('/api/pilot/audit-account');
      renderPilotAccountCleanliness(audit);
      await loadPilot(true);
    }catch(e){
      document.getElementById('accountCleanBadge').textContent='Error';
      document.getElementById('accountCleanStatus').textContent='No se pudo completar la auditoría: '+String(e&&e.message?e.message:e);
    }finally{button.disabled=false}
  }
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
    "    renderEmergency(data);\n    renderPilotFireDrill(data.fireDrill);\n    document.getElementById('raw').textContent=JSON.stringify(data,null,2);",
    "    renderEmergency(data);\n    renderPilotAccountCleanliness(data.accountCleanliness);\n    renderPilotFireDrill(data.fireDrill);\n    document.getElementById('raw').textContent=JSON.stringify(data,null,2);",
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
