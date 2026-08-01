import { terminalV2DemoDashboard } from "./demo-dashboard-terminal-v2";

/**
 * Limpia definitivamente los bloques heredados que quedaban debajo de la
 * aplicación DEMO v3 y añade contexto operativo cuando no hay posiciones.
 * No altera el motor PAPER, sus señales ni la ejecución LIVE.
 */
export async function terminalV4DemoDashboard(): Promise<Response> {
  const base = await terminalV2DemoDashboard();
  let html = await base.text();

  if (!html.includes("</body>")) {
    throw new Error("DEMO_V4_BODY_MARKER_MISSING");
  }

  html = html.replace(
    "</body>",
    `<script>
(function(){
  function cleanLegacyContent(){
    const shell=document.querySelector('.demo-shell');
    if(!shell||!shell.parentElement)return;
    let node=shell.nextElementSibling;
    while(node){
      const next=node.nextElementSibling;
      node.remove();
      node=next;
    }
  }
  function explainFlatState(){
    const panel=document.getElementById('panel-positions');
    if(!panel)return;
    const empty=panel.querySelector('.demo-empty');
    if(!empty)return;
    if(!empty.querySelector('.demo-flat-explanation')){
      const note=document.createElement('div');
      note.className='demo-flat-explanation';
      note.style.marginTop='10px';
      note.style.fontSize='12px';
      note.style.lineHeight='1.55';
      note.innerHTML='<strong>Estado plano:</strong> las posiciones anteriores ya fueron cerradas. El motor no abre una operación continuamente; permanece observando hasta que una nueva señal supera entrada, costes y riesgo. Resumen y Posiciones leen el mismo estado PAPER.';
      empty.appendChild(note);
    }
  }
  function verifyConsistency(){
    const summary=document.getElementById('panel-summary');
    const positions=document.getElementById('panel-positions');
    if(!summary||!positions)return;
    positions.querySelectorAll('.legacy-demo-hidden,[data-legacy-demo]').forEach(function(node){node.remove()});
  }
  function apply(){cleanLegacyContent();explainFlatState();verifyConsistency()}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',apply);else apply();
  const positions=document.getElementById('panel-positions');
  if(positions)new MutationObserver(function(){explainFlatState();verifyConsistency()}).observe(positions,{childList:true,subtree:true});
  setInterval(apply,5000);
})();
</script></body>`,
  );

  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Pragma": "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
