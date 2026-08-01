import { pilotDashboard } from "./pilot-dashboard";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`PILOT_DASHBOARD_INTEGRATION_MARKER_MISSING:${search.slice(0, 40)}`);
  }
  return source.replace(search, replacement);
}

/**
 * Añade autenticación por sesión y las dos únicas acciones validate-only.
 * El token y el clOrdId preparado viven solo en sessionStorage de la pestaña.
 */
export async function authenticatedPilotDashboard(): Promise<Response> {
  const base = pilotDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.auth-card,.validation-card{background:rgba(15,29,49,.98);border:1px solid #35557f;border-radius:19px;padding:17px;margin:12px 0}.auth-card input{width:100%;padding:12px 13px;border-radius:13px;border:1px solid #405d82;background:#081526;color:var(--text);font:inherit;margin:9px 0}.auth-actions,.validation-actions{display:flex;gap:8px;flex-wrap:wrap}.secondary{background:#172b46;color:#c8dbf4;border:1px solid #35557f}.validate-button{background:#d7f6e9;color:#0a3525}.auth-status,.action-status{font-size:12px;color:var(--muted);line-height:1.5;margin-top:8px}.validation-note{padding:10px 11px;border-radius:12px;background:rgba(73,221,161,.08);border:1px solid rgba(73,221,161,.25);color:#baf5dc;font-size:12px;line-height:1.5;margin:10px 0}.phase-note{padding:10px 11px;border-radius:12px;background:rgba(105,167,255,.08);border:1px solid rgba(105,167,255,.25);color:#cde2ff;font-size:12px;line-height:1.5;margin:10px 0}</style>`,
  );

  html = replaceRequired(
    html,
    '<div id="error" class="error"></div>',
    `<section id="authCard" class="auth-card">
      <div class="between"><div><strong>Acceso privado</strong><div class="auth-status">Introduce el ADMIN_TOKEN. Solo permanecerá en esta pestaña del iPhone.</div></div><span class="badge">Sesión local</span></div>
      <input id="pilotToken" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="ADMIN_TOKEN">
      <div class="auth-actions"><button class="small" onclick="savePilotToken()">Guardar en esta pestaña</button><button class="small secondary" onclick="refreshPilotSafetyChecks()">Actualizar comprobaciones seguras</button><button class="small secondary" onclick="forgetPilotToken()">Olvidar token</button></div>
      <div id="authStatus" class="auth-status">El token no se incluye en la URL, el HTML ni el informe técnico.</div>
    </section>

    <section id="validationCard" class="validation-card">
      <div class="between"><div><strong>Validación previa sin envío</strong><div class="action-status">El servidor decide par, precio, volumen e importe usando Kraken.</div></div><span class="badge">Máximo 5 €</span></div>
      <div class="validation-note">Preparar solo escribe estado local. Validar usa Kraken con <strong>validate=true</strong>: comprueba la orden, pero no la envía al motor de mercado.</div>
      <div class="phase-note"><strong>Importante:</strong> los bloqueos PAPER pueden impedir un piloto con dinero real, pero no impiden completar esta validación técnica sin envío.</div>
      <div class="validation-actions">
        <button id="prepareValidationButton" class="small" disabled onclick="prepareValidationOnly()">Paso 1 · Preparar validación de hasta 5 €</button>
        <button id="runPreflightButton" class="small validate-button" style="display:none" onclick="runValidationPreflight()">Paso 2 · Validar en Kraken — no enviar</button>
      </div>
      <div id="validationActionStatus" class="action-status">Esperando autenticación y comprobaciones seguras de Kraken.</div>
    </section>

    <div id="error" class="error"></div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  const PILOT_TOKEN_KEY='auto-bolsa-ai-pilot-admin-token';
  const PILOT_CL_ORD_ID_KEY='auto-bolsa-ai-pilot-validation-clordid';
  const PILOT_SAFE_REFRESH_KEY='auto-bolsa-ai-pilot-safe-refresh';
  function currentPilotToken(){return sessionStorage.getItem(PILOT_TOKEN_KEY)||''}
  function currentPreparedClOrdId(){return sessionStorage.getItem(PILOT_CL_ORD_ID_KEY)||''}
  function currentKrakenReady(){return sessionStorage.getItem(PILOT_SAFE_REFRESH_KEY)==='ready'}
  function updateAuthStatus(message){document.getElementById('authStatus').textContent=message}
  function updateValidationControls(message){
    const clOrdId=currentPreparedClOrdId();
    const ready=currentPilotToken().length>0&&currentKrakenReady();
    document.getElementById('prepareValidationButton').disabled=!ready;
    document.getElementById('runPreflightButton').style.display=clOrdId?'inline-block':'none';
    document.getElementById('validationActionStatus').textContent=message||(clOrdId?'Orden local preparada. Ya puede validarse sin enviar.':ready?'Kraken autenticado y permisos seguros. Ya puedes ejecutar el Paso 1.':'Esperando autenticación y comprobaciones seguras de Kraken.');
  }
  function restorePilotAuth(){
    const present=currentPilotToken().length>0;
    updateAuthStatus(present?'Token restaurado. Revalidando conexión, saldo y permisos de Kraken…':'Introduce el token para cargar el informe privado.');
    sessionStorage.removeItem(PILOT_SAFE_REFRESH_KEY);
    updateValidationControls('');
  }
  async function savePilotToken(){
    const input=document.getElementById('pilotToken');
    const token=String(input.value||'').trim();
    if(!token){updateAuthStatus('El token no puede estar vacío.');return}
    sessionStorage.setItem(PILOT_TOKEN_KEY,token);
    sessionStorage.removeItem(PILOT_SAFE_REFRESH_KEY);
    input.value='';
    updateAuthStatus('Token guardado únicamente durante esta pestaña. Comprobando Kraken…');
    updateValidationControls('Comprobando autenticación, saldo y permisos antes de habilitar el Paso 1…');
    await refreshPilotSafetyChecks();
  }
  function forgetPilotToken(){
    sessionStorage.removeItem(PILOT_TOKEN_KEY);
    sessionStorage.removeItem(PILOT_CL_ORD_ID_KEY);
    sessionStorage.removeItem(PILOT_SAFE_REFRESH_KEY);
    document.getElementById('pilotToken').value='';
    updateAuthStatus('Token eliminado de esta pestaña.');
    updateValidationControls('Esperando autenticación y comprobaciones seguras de Kraken.');
    document.getElementById('updated').textContent='Acceso privado pendiente';
  }
  async function authenticatedPilotPost(path,body){
    const token=currentPilotToken();
    if(!token)throw new Error('Introduce primero el ADMIN_TOKEN.');
    const init={method:'POST',headers:{Authorization:'Bearer '+token}};
    if(body!==undefined){init.headers['Content-Type']='application/json';init.body=JSON.stringify(body)}
    const response=await fetch(path,init);
    if(response.status===401){
      sessionStorage.removeItem(PILOT_TOKEN_KEY);
      sessionStorage.removeItem(PILOT_CL_ORD_ID_KEY);
      sessionStorage.removeItem(PILOT_SAFE_REFRESH_KEY);
      updateAuthStatus('Token incorrecto o caducado. Introdúcelo de nuevo.');
      updateValidationControls('Acceso privado caducado.');
      throw new Error('Acceso no autorizado.');
    }
    const text=await response.text();
    let data={};try{data=JSON.parse(text)}catch(e){data={message:text}}
    if(!response.ok)throw new Error(data.message||data.error||(Array.isArray(data.blockers)?data.blockers.join('; '):'Acción bloqueada'));
    return data;
  }
  function krakenSafetyReason(data){
    const connection=data&&data.kraken&&data.kraken.connection?data.kraken.connection:{};
    const permissions=data&&data.kraken&&data.kraken.permissions?data.kraken.permissions:{};
    const reasons=[];
    if(connection.connected!==true){
      if(connection.error)reasons.push('Conexión: '+connection.error);
      else reasons.push('Kraken no confirmó la autenticación o el saldo.');
    }
    if(permissions.auditComplete!==true||permissions.safePermissions!==true){
      if(permissions.error)reasons.push('Permisos: '+permissions.error);
      else reasons.push('Kraken no confirmó una auditoría de permisos segura.');
    }
    return reasons.join(' ');
  }
  async function refreshPilotSafetyChecks(){
    const token=currentPilotToken();
    if(!token){updateAuthStatus('Introduce primero el ADMIN_TOKEN.');updateValidationControls('Esperando autenticación y comprobaciones seguras de Kraken.');return}
    sessionStorage.removeItem(PILOT_SAFE_REFRESH_KEY);
    updateValidationControls('Comprobando autenticación, saldo y permisos antes de habilitar el Paso 1…');
    updateAuthStatus('Comprobando conexión, saldo y permisos de Kraken…');
    try{
      const data=await authenticatedPilotPost('/api/pilot/refresh-kraken');
      const connection=data&&data.kraken&&data.kraken.connection?data.kraken.connection:{};
      const permissions=data&&data.kraken&&data.kraken.permissions?data.kraken.permissions:{};
      const ready=connection.connected===true&&permissions.auditComplete===true&&permissions.safePermissions===true;
      if(!ready){
        sessionStorage.removeItem(PILOT_SAFE_REFRESH_KEY);
        const reason=krakenSafetyReason(data)||'Kraken no devolvió una comprobación segura.';
        updateAuthStatus('Comprobaciones completadas, pero Kraken sigue bloqueado. '+reason);
        updateValidationControls('Paso 1 deshabilitado: '+reason);
        await loadPilot(true);
        return;
      }
      sessionStorage.setItem(PILOT_SAFE_REFRESH_KEY,'ready');
      updateAuthStatus('Token válido. Conexión, saldo y permisos de Kraken confirmados.');
      updateValidationControls('Kraken autenticado y permisos seguros. Ya puedes ejecutar el Paso 1.');
      await loadPilot(true);
    }catch(e){
      sessionStorage.removeItem(PILOT_SAFE_REFRESH_KEY);
      const message=String(e&&e.message?e.message:e);
      updateAuthStatus('No se pudieron completar las comprobaciones: '+message);
      updateValidationControls('Paso 1 deshabilitado: '+message);
      await loadPilot(true);
    }
  }
  async function prepareValidationOnly(){
    if(!currentKrakenReady()){updateValidationControls('Paso 1 deshabilitado hasta confirmar autenticación, saldo y permisos. Pulsa “Actualizar comprobaciones seguras”.');return}
    if(!window.confirm('Se construirá una propuesta con datos reales de Kraken y se guardará únicamente como orden local preparada. No se enviará dinero. ¿Continuar?'))return;
    const button=document.getElementById('prepareValidationButton');button.disabled=true;
    updateValidationControls('Construyendo propuesta segura desde Kraken…');
    try{
      const data=await authenticatedPilotPost('/api/pilot/prepare-validation');
      const clOrdId=String(data.clOrdId||'');
      if(!clOrdId)throw new Error('El servidor no devolvió clOrdId preparado.');
      sessionStorage.setItem(PILOT_CL_ORD_ID_KEY,clOrdId);
      updateValidationControls('Preparación local completada. Importe: '+Number(data.proposal?.notionalEur||0).toLocaleString('es-ES',{style:'currency',currency:'EUR'})+'. No se contactó con el endpoint privado de órdenes.');
      await loadPilot(true);
    }catch(e){updateValidationControls('Preparación bloqueada: '+String(e&&e.message?e.message:e))}finally{button.disabled=!currentKrakenReady()}
  }
  async function runValidationPreflight(){
    const clOrdId=currentPreparedClOrdId();
    if(!clOrdId){updateValidationControls('Primero debes preparar una validación local.');return}
    if(!window.confirm('Kraken comprobará esta orden con validate=true. No se creará una orden real ni se enviará al mercado. ¿Continuar?'))return;
    const button=document.getElementById('runPreflightButton');button.disabled=true;
    updateValidationControls('Validando con Kraken mediante validate=true…');
    try{
      const data=await authenticatedPilotPost('/api/pilot/preflight',{clOrdId:clOrdId});
      if(data.status!=='validated'||data.realOrderCreated!==false)throw new Error('Kraken no devolvió una validación limpia y demostrable.');
      updateValidationControls('Validación completada: Kraken aceptó la forma de la orden con validate=true y no creó ninguna orden real.');
      await loadPilot(true);
    }catch(e){updateValidationControls('Validación bloqueada: '+String(e&&e.message?e.message:e))}finally{button.disabled=false}
  }
`,
  );

  html = replaceRequired(
    html,
    "const response=await fetch('/api/pilot/readiness',{cache:'no-store'});",
    `const token=currentPilotToken();
      if(!token){
        error.textContent='Introduce el ADMIN_TOKEN en Acceso privado para cargar el informe.';
        error.style.display='block';
        loading=false;
        return;
      }
      const response=await fetch('/api/pilot/readiness',{cache:'no-store',headers:{Authorization:'Bearer '+token}});
      if(response.status===401){
        sessionStorage.removeItem(PILOT_TOKEN_KEY);
        sessionStorage.removeItem(PILOT_CL_ORD_ID_KEY);
        sessionStorage.removeItem(PILOT_SAFE_REFRESH_KEY);
        updateAuthStatus('Token incorrecto o caducado. Introdúcelo de nuevo.');
        updateValidationControls('Acceso privado caducado.');
        error.textContent='Acceso no autorizado. El token se ha eliminado de esta pestaña.';
        error.style.display='block';
        loading=false;
        return;
      }`,
  );

  html = replaceRequired(
    html,
    "loadPilot(false);setInterval(function(){loadPilot(false)},15000);",
    "restorePilotAuth();if(currentPilotToken()){refreshPilotSafetyChecks()}else{loadPilot(false)}setInterval(function(){if(currentPilotToken())loadPilot(false)},15000);",
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
