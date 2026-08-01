import { pilotDashboard } from "./pilot-dashboard";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) {
    throw new Error(`PILOT_DASHBOARD_INTEGRATION_MARKER_MISSING:${search.slice(0, 40)}`);
  }
  return source.replace(search, replacement);
}

/**
 * Adds browser-session authentication to the read-only pilot dashboard.
 *
 * The ADMIN_TOKEN is entered by the user in the browser and stored only in
 * sessionStorage for the current tab. It is never embedded in HTML, placed in
 * a URL, persisted by the Worker, logged, or returned in the readiness report.
 */
export async function authenticatedPilotDashboard(): Promise<Response> {
  const base = pilotDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.auth-card{background:rgba(15,29,49,.98);border:1px solid #35557f;border-radius:19px;padding:17px;margin:12px 0}.auth-card input{width:100%;padding:12px 13px;border-radius:13px;border:1px solid #405d82;background:#081526;color:var(--text);font:inherit;margin:9px 0}.auth-actions{display:flex;gap:8px;flex-wrap:wrap}.secondary{background:#172b46;color:#c8dbf4;border:1px solid #35557f}.auth-status{font-size:12px;color:var(--muted);line-height:1.45;margin-top:8px}</style>`,
  );

  html = replaceRequired(
    html,
    '<div id="error" class="error"></div>',
    `<section id="authCard" class="auth-card">
      <div class="between"><div><strong>Acceso privado</strong><div class="auth-status">Introduce el ADMIN_TOKEN. Solo permanecerá en esta pestaña del iPhone.</div></div><span class="badge">Sesión local</span></div>
      <input id="pilotToken" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="ADMIN_TOKEN">
      <div class="auth-actions"><button class="small" onclick="savePilotToken()">Guardar en esta pestaña</button><button class="small secondary" onclick="forgetPilotToken()">Olvidar token</button></div>
      <div id="authStatus" class="auth-status">El token no se incluye en la URL, el HTML ni el informe técnico.</div>
    </section>

    <section id="pilotValidationCard" class="auth-card">
      <div class="between"><div><strong>Validación sin envío (máx. 5 €)</strong><div class="auth-status">Preparar solo escribe estado local. Validar contacta con Kraken en modo validate=true y nunca envía ni crea una orden real.</div></div><span class="badge">Sin ejecución</span></div>
      <div class="auth-actions">
        <button class="small" onclick="preparePilotValidation()">Preparar validación de hasta 5 €</button>
        <button id="pilotValidateButton" class="small secondary" style="display:none" onclick="validatePilotOrder()">Validar en Kraken — no enviar</button>
      </div>
      <div id="pilotValidationStatus" class="auth-status">Sin acciones todavía.</div>
    </section>

    <div id="error" class="error"></div>`,
  );

  html = replaceRequired(
    html,
    "<script>\n",
    `<script>
  const PILOT_TOKEN_KEY='auto-bolsa-ai-pilot-admin-token';
  function currentPilotToken(){return sessionStorage.getItem(PILOT_TOKEN_KEY)||''}
  function updateAuthStatus(message){document.getElementById('authStatus').textContent=message}
  function restorePilotAuth(){
    const present=currentPilotToken().length>0;
    updateAuthStatus(present?'Token guardado únicamente durante esta pestaña.':'Introduce el token para cargar el informe privado.');
  }
  function savePilotToken(){
    const input=document.getElementById('pilotToken');
    const token=String(input.value||'').trim();
    if(!token){updateAuthStatus('El token no puede estar vacío.');return}
    sessionStorage.setItem(PILOT_TOKEN_KEY,token);
    input.value='';
    updateAuthStatus('Token guardado únicamente durante esta pestaña.');
    loadPilot(true);
  }
  function forgetPilotToken(){
    sessionStorage.removeItem(PILOT_TOKEN_KEY);
    document.getElementById('pilotToken').value='';
    updateAuthStatus('Token eliminado de esta pestaña.');
    document.getElementById('updated').textContent='Acceso privado pendiente';
  }
  let pilotPreparedClOrdId=null;
  function setPilotValidationStatus(message){document.getElementById('pilotValidationStatus').textContent=message}
  async function pilotAuthorizedPost(path,payload){
    const token=currentPilotToken();
    if(!token){setPilotValidationStatus('Introduce primero el ADMIN_TOKEN en Acceso privado.');return null}
    const options={method:'POST',headers:{Authorization:'Bearer '+token}};
    if(payload!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(payload)}
    const response=await fetch(path,options);
    const text=await response.text();
    let body=null;try{body=JSON.parse(text)}catch(e){body=null}
    return {response,body};
  }
  async function preparePilotValidation(){
    if(!confirm('Esto solo prepara un estado local de hasta 5 €. No contacta con Kraken ni envía ninguna orden. ¿Continuar?'))return;
    setPilotValidationStatus('Preparando…');
    const result=await pilotAuthorizedPost('/api/pilot/prepare-validation');
    if(!result)return;
    const {response,body}=result;
    const clOrdId=body&&body.order&&body.order.clOrdId?body.order.clOrdId:null;
    if(!response.ok||!body||body.ok===false||!clOrdId){
      pilotPreparedClOrdId=null;
      document.getElementById('pilotValidateButton').style.display='none';
      setPilotValidationStatus('No se pudo preparar: '+((body&&Array.isArray(body.blockers)&&body.blockers.length)?body.blockers.join('; '):((body&&(body.error||body.message))||'error desconocido')));
      loadPilot(true);
      return;
    }
    pilotPreparedClOrdId=clOrdId;
    document.getElementById('pilotValidateButton').style.display='inline-block';
    setPilotValidationStatus('Orden local preparada ('+clOrdId+'). Todavía no se ha contactado con Kraken.');
    loadPilot(true);
  }
  async function validatePilotOrder(){
    if(!pilotPreparedClOrdId){setPilotValidationStatus('Primero prepara una validación.');return}
    if(!confirm('Esto contacta con Kraken en modo validate=true. Kraken no crea ninguna orden real ni la envía al mercado. ¿Continuar?'))return;
    setPilotValidationStatus('Validando con Kraken (validate=true)…');
    const result=await pilotAuthorizedPost('/api/pilot/preflight',{clOrdId:pilotPreparedClOrdId});
    if(!result)return;
    const {body}=result;
    setPilotValidationStatus((body&&body.status==='validated')?'Kraken validó la orden en modo validate=true. No se ha enviado nada real.':('Resultado: '+((body&&body.status)?body.status:'desconocido')+((body&&body.message)?(' · '+body.message):'')));
    loadPilot(true);
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
        updateAuthStatus('Token incorrecto o caducado. Introdúcelo de nuevo.');
        error.textContent='Acceso no autorizado. El token se ha eliminado de esta pestaña.';
        error.style.display='block';
        loading=false;
        return;
      }`,
  );

  html = replaceRequired(
    html,
    "loadPilot(false);setInterval(function(){loadPilot(false)},15000);",
    "restorePilotAuth();loadPilot(false);setInterval(function(){if(currentPilotToken())loadPilot(false)},15000);",
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
