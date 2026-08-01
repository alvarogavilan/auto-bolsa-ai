import { authenticatedPilotDashboard as baseAuthenticatedPilotDashboard } from "./pilot-dashboard-access-base";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`PILOT_FEES_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

export async function feesAwarePilotDashboard(): Promise<Response> {
  const base = await baseAuthenticatedPilotDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.fees-card{background:rgba(15,29,49,.98);border:1px solid #35557f;border-radius:19px;padding:17px;margin:12px 0}.fees-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:9px;margin-top:12px}.fee-metric{padding:11px;background:#0c1a2d;border-radius:13px}.fee-metric span{display:block;color:var(--muted);font-size:11px;margin-bottom:5px}.fee-metric strong{font-size:15px}.fee-message{font-size:12px;line-height:1.5;margin-top:11px;padding:10px 11px;border-radius:12px;background:rgba(105,167,255,.08);border:1px solid rgba(105,167,255,.25);color:#cde2ff}.fee-message.warning{background:rgba(255,209,102,.08);border-color:rgba(255,209,102,.3);color:#ffe3a8}.fee-message.error{background:rgba(255,124,136,.08);border-color:rgba(255,124,136,.3);color:#ffd0d5}@media(max-width:720px){.fees-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:440px){.fees-grid{grid-template-columns:1fr}}</style>`,
  );

  html = replaceRequired(
    html,
    '    <section id="validationCard" class="validation-card">',
    `    <section id="feesCard" class="fees-card">
      <div class="between"><div><strong>Tarifas efectivas de Kraken</strong><div class="action-status">Lectura privada de la cuenta para el par configurado. No crea órdenes.</div></div><span id="feesStatusBadge" class="badge">Pendiente</span></div>
      <div id="feesGrid" class="fees-grid">
        <div class="fee-metric"><span>Saldo EUR</span><strong>—</strong></div>
        <div class="fee-metric"><span>Taker</span><strong>—</strong></div>
        <div class="fee-metric"><span>Maker</span><strong>—</strong></div>
        <div class="fee-metric"><span>Volumen 30 días</span><strong>—</strong></div>
      </div>
      <div id="feesMessage" class="fee-message">Guarda el token o pulsa “Actualizar comprobaciones seguras”.</div>
    </section>

    <section id="validationCard" class="validation-card">`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function feePercent(value){
    const numberValue=Number(value);if(!Number.isFinite(numberValue))return '—';
    return numberValue.toFixed(4).replace('.',',')+' %';
  }
  function feeMoney(value){
    const numberValue=Number(value);if(!Number.isFinite(numberValue))return '—';
    return numberValue.toLocaleString('es-ES',{style:'currency',currency:'EUR',minimumFractionDigits:2,maximumFractionDigits:4});
  }
  function renderEffectiveFees(connection){
    const badge=document.getElementById('feesStatusBadge');
    const grid=document.getElementById('feesGrid');
    const message=document.getElementById('feesMessage');
    const audit=connection&&connection.effectiveFees?connection.effectiveFees:null;
    const status=connection&&connection.effectiveFeesStatus?connection.effectiveFeesStatus:{};
    const eurBalance=connection&&Number.isFinite(Number(connection.eurBalance))?Number(connection.eurBalance):null;
    if(!audit){
      badge.textContent=status.available===false?'No disponible':'Pendiente';
      grid.innerHTML=[['Saldo EUR',eurBalance===null?'—':feeMoney(eurBalance)],['Taker','—'],['Maker','—'],['Volumen 30 días','—']].map(function(item){return '<div class="fee-metric"><span>'+item[0]+'</span><strong>'+item[1]+'</strong></div>'}).join('');
      message.className='fee-message '+(status.error?'error':'');
      message.textContent=status.error?'La conexión Kraken funciona, pero la auditoría de tarifas no está disponible: '+String(status.error):'Esperando la primera auditoría de tarifas de solo lectura.';
      return;
    }
    const taker=audit.taker&&Number.isFinite(Number(audit.taker.percent))?Number(audit.taker.percent):null;
    const maker=audit.maker&&Number.isFinite(Number(audit.maker.percent))?Number(audit.maker.percent):null;
    const volume=Number.isFinite(Number(audit.volume30d))?Number(audit.volume30d):null;
    const assumed=Number.isFinite(Number(audit.assumedPaperFeeEachSidePct))?Number(audit.assumedPaperFeeEachSidePct):null;
    badge.textContent='Lectura confirmada';
    grid.innerHTML=[
      ['Saldo EUR',eurBalance===null?'—':feeMoney(eurBalance)],
      ['Taker',taker===null?'—':feePercent(taker)],
      ['Maker',maker===null?'—':feePercent(maker)],
      ['Volumen 30 días',volume===null?'—':feeMoney(volume)]
    ].map(function(item){return '<div class="fee-metric"><span>'+item[0]+'</span><strong>'+item[1]+'</strong></div>'}).join('');
    const matches=audit.paperFeeMatchesCurrentTaker===true;
    message.className='fee-message '+(matches?'':'warning');
    message.textContent=matches
      ? 'La comisión taker efectiva coincide con el '+feePercent(assumed)+' por lado usado actualmente en PAPER. La cohorte forward permanece congelada.'
      : 'La comisión taker efectiva ('+feePercent(taker)+') no coincide con el supuesto PAPER ('+feePercent(assumed)+'). No se cambiará retroactivamente: la diferencia se registrará y cualquier nueva configuración exigirá una cohorte separada.';
  }
  async function loadEffectiveFees(){
    const token=currentPilotToken();
    if(!token){renderEffectiveFees(null);return}
    const badge=document.getElementById('feesStatusBadge');badge.textContent='Consultando';
    try{
      const response=await fetch('/api/kraken/connection',{cache:'no-store',headers:{Authorization:'Bearer '+token}});
      if(response.status===401){renderEffectiveFees({effectiveFeesStatus:{available:false,error:'Acceso privado caducado'}});return}
      const data=await response.json();
      renderEffectiveFees(data);
    }catch(e){renderEffectiveFees({effectiveFeesStatus:{available:false,error:String(e&&e.message?e.message:e)}})}
  }
`,
  );

  html = replaceRequired(
    html,
    "restorePilotAuth();if(currentPilotToken()){refreshPilotSafetyChecks()}else{loadPilot(false)}setInterval(function(){if(currentPilotToken())loadPilot(false)},15000);",
    `const baseRefreshPilotSafetyChecks=refreshPilotSafetyChecks;
  refreshPilotSafetyChecks=async function(){await baseRefreshPilotSafetyChecks();if(currentPilotToken())await loadEffectiveFees()};
  restorePilotAuth();if(currentPilotToken()){refreshPilotSafetyChecks()}else{loadPilot(false);renderEffectiveFees(null)}setInterval(function(){if(currentPilotToken()){loadPilot(false);loadEffectiveFees()}},15000);`,
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
