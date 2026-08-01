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
