import { fireDrillPilotDashboard } from "./pilot-dashboard-fire-drill";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`PILOT_MANIFEST_MARKER_MISSING:${search.slice(0, 48)}`);
  }
  return source.replace(search, replacement);
}

export async function manifestPilotDashboard(): Promise<Response> {
  const base = await fireDrillPilotDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    '<div id="error" class="error"></div>',
    `<section class="validation-card">
      <div class="between"><div><strong>Manifiesto de una sola orden</strong><div class="action-status">Sella el expediente, la orden y los costes en una huella SHA-256 efímera.</div></div><span id="manifestBadge" class="badge">No generado</span></div>
      <div class="phase-note">No es una autorización ni un token de envío. Caduca en dos minutos, no se persiste y siempre mantiene <strong>submitCapable=false</strong>.</div>
      <div id="manifestGrid" class="grid3" style="margin-top:10px">
        <div class="mini"><span>ID del manifiesto</span><strong id="manifestId">—</strong></div>
        <div class="mini"><span>Caducidad</span><strong id="manifestExpiry">—</strong></div>
        <div class="mini"><span>Orden sellada</span><strong id="manifestOrder">—</strong></div>
        <div class="mini"><span>Taker efectivo</span><strong id="manifestFee">—</strong></div>
        <div class="mini"><span>Reserva mínima</span><strong id="manifestReserve">—</strong></div>
        <div class="mini"><span>Puede enviar</span><strong id="manifestSubmit">No</strong></div>
      </div>
      <div class="validation-actions" style="margin-top:10px"><button id="manifestButton" class="small secondary" onclick="generatePilotManifestFromApp()">Generar manifiesto sellado</button></div>
      <div id="manifestStatus" class="action-status">Pendiente. Puede generarse aunque existan bloqueos para mostrar exactamente qué falta.</div>
      <div id="manifestBlockers" class="list" style="margin-top:10px"></div>
    </section>

    <div id="error" class="error"></div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  function renderPilotManifest(manifest){
    const eligible=Boolean(manifest&&manifest.eligibleForHumanArming===true);
    document.getElementById('manifestBadge').textContent=eligible?'Listo para revisión humana':'Bloqueado';
    document.getElementById('manifestId').textContent=manifest&&manifest.manifestId?String(manifest.manifestId):'—';
    document.getElementById('manifestExpiry').textContent=manifest&&manifest.expiresAt?time(manifest.expiresAt):'—';
    const order=manifest&&manifest.order?manifest.order:null;
    document.getElementById('manifestOrder').textContent=order?String(order.side).toUpperCase()+' '+money(order.notionalEur)+' · '+String(order.pair):'No preparada';
    const economics=manifest&&manifest.economics?manifest.economics:{};
    document.getElementById('manifestFee').textContent=economics.takerFeePercent===null||economics.takerFeePercent===undefined?'No disponible':Number(economics.takerFeePercent).toFixed(4).replace('.',',')+' %';
    document.getElementById('manifestReserve').textContent=economics.minimumReservedEur===null||economics.minimumReservedEur===undefined?'No disponible':money(economics.minimumReservedEur);
    document.getElementById('manifestSubmit').textContent=manifest&&manifest.submitCapable===true?'Sí':'No';
    const blockers=Array.isArray(manifest&&manifest.blockers)?manifest.blockers:[];
    document.getElementById('manifestStatus').textContent=eligible
      ?'El expediente está sellado para revisión humana, pero todavía no existe ninguna capacidad de envío.'
      :'Manifiesto generado con '+String(blockers.length)+' bloqueo(s). No puede armar ni enviar.';
    document.getElementById('manifestBlockers').innerHTML=blockers.map(function(item){return '<div class="item blocker">'+escapeHtml(item)+'</div>'}).join('');
  }
  async function generatePilotManifestFromApp(){
    const button=document.getElementById('manifestButton');
    button.disabled=true;
    document.getElementById('manifestStatus').textContent='Reconstruyendo expediente, cuenta y comisiones…';
    document.getElementById('manifestBlockers').innerHTML='';
    try{
      const manifest=await authenticatedPilotPost('/api/pilot/one-shot-manifest');
      renderPilotManifest(manifest);
    }catch(e){
      document.getElementById('manifestBadge').textContent='Error';
      document.getElementById('manifestStatus').textContent='No se pudo generar: '+String(e&&e.message?e.message:e);
    }finally{button.disabled=false}
  }
`,
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
