import { auditedDemoDashboard } from "./demo-dashboard-audit";

function replaceRequired(source: string, search: string, replacement: string): string {
  if (!source.includes(search)) throw new Error(`DEMO_TERMINAL_MARKER_MISSING:${search.slice(0, 64)}`);
  return source.replace(search, replacement);
}

/**
 * Presentación mobile-first inspirada en la arquitectura informativa de una
 * terminal spot: Vista general, Cartera, Órdenes, Rendimiento y Sistema.
 * No replica marcas ni diseño propietario y no altera señales ni ejecución.
 */
export async function terminalDemoDashboard(): Promise<Response> {
  const base = await auditedDemoDashboard();
  let html = await base.text();

  html = replaceRequired(
    html,
    "</style>",
    `.terminal-nav{position:sticky;top:0;z-index:50;display:flex;gap:7px;overflow-x:auto;padding:9px 2px 11px;margin:0 0 12px;background:linear-gradient(180deg,#102b4d 72%,rgba(16,43,77,0));scrollbar-width:none}.terminal-nav::-webkit-scrollbar{display:none}.terminal-tab{flex:0 0 auto;border:1px solid var(--line);background:rgba(4,17,31,.62);color:var(--muted);padding:9px 12px;border-radius:999px;font:inherit;font-size:12px;font-weight:800}.terminal-tab.active{background:#eef4ff;color:#10213a;border-color:#eef4ff}.terminal-panel-hidden{display:none!important}.terminal-proof{padding:10px 12px;margin:0 0 12px;border:1px solid rgba(73,221,161,.34);border-radius:13px;background:rgba(73,221,161,.08);font-size:12px;line-height:1.5}.terminal-proof strong{color:var(--green)}.terminal-quick{display:grid;grid-template-columns:repeat(2,1fr);gap:8px;margin-bottom:12px}.terminal-quick .mini{padding:12px}.terminal-quick strong{font-size:20px}.terminal-section-title{font-size:11px;text-transform:uppercase;letter-spacing:.14em;color:var(--muted);font-weight:800;margin:7px 2px 9px}@media(min-width:721px){.terminal-quick{grid-template-columns:repeat(4,1fr)}}</style>`,
  );

  html = replaceRequired(
    html,
    '<div id="error" class="error"></div>',
    `<div id="error" class="error"></div>
    <div class="terminal-proof"><strong>INTERFAZ DEMO v2 ACTIVA</strong> · Cuenta operativa mostrada sobre una referencia de 50 €, separada del laboratorio comparativo de nueve estrategias.</div>
    <nav id="terminalNav" class="terminal-nav" aria-label="Secciones de la DEMO">
      <button class="terminal-tab active" data-terminal-target="overview">Resumen</button>
      <button class="terminal-tab" data-terminal-target="portfolio">Cartera</button>
      <button class="terminal-tab" data-terminal-target="orders">Órdenes</button>
      <button class="terminal-tab" data-terminal-target="performance">Rendimiento</button>
      <button class="terminal-tab" data-terminal-target="system">Sistema</button>
    </nav>
    <div id="terminalQuick" class="terminal-quick"></div>`,
  );

  html = html.replace("Cartera PAPER global", "Cuenta PAPER equivalente · 50 €");
  html = html.replace(
    "Suma todas las estrategias del laboratorio: saldo libre, capital invertido, valor actual y resultados separados.",
    "Vista operativa equivalente a una cuenta de 50 €. El laboratorio multi-estrategia se conserva aparte como evidencia comparativa.",
  );

  html = replaceRequired(
    html,
    "</body>",
    `<script>
+(function(){
+  function textOf(selector){const node=document.querySelector(selector);return node?node.textContent.trim():'—'}
+  function classifySections(){
+    const sections=Array.from(document.querySelectorAll('main section.card, section.card'));
+    sections.forEach(function(section,index){
+      const title=(section.querySelector('h2,h3')||{}).textContent||'';
+      let group='system';
+      if(index===0||/Cuenta PAPER|Cartera PAPER/i.test(title))group='portfolio';
+      else if(/Salud|Técnic|Motor|Mercado|Estrateg/i.test(title))group='system';
+      else if(/Rendimiento|Curva|Benchmark|PnL|Estadíst/i.test(title))group='performance';
+      else if(/Orden|Historial|Operaci/i.test(title))group='orders';
+      section.dataset.terminalGroup=group;
+    });
+  }
+  function renderQuick(){
+    const grid=document.getElementById('executiveGrid'),quick=document.getElementById('terminalQuick');if(!grid||!quick)return;
+    const minis=Array.from(grid.querySelectorAll('.mini')).slice(0,4);
+    quick.innerHTML=minis.map(function(node){return node.outerHTML}).join('');
+  }
+  function show(target){
+    const sections=Array.from(document.querySelectorAll('[data-terminal-group]'));
+    sections.forEach(function(section){
+      const group=section.dataset.terminalGroup;
+      const visible=target==='overview'?['portfolio','performance'].includes(group):group===target;
+      section.classList.toggle('terminal-panel-hidden',!visible);
+    });
+    document.querySelectorAll('.terminal-tab').forEach(function(button){button.classList.toggle('active',button.dataset.terminalTarget===target)});
+    window.scrollTo({top:0,behavior:'smooth'});
+  }
+  function init(){
+    classifySections();renderQuick();
+    document.querySelectorAll('.terminal-tab').forEach(function(button){button.addEventListener('click',function(){show(button.dataset.terminalTarget||'overview')})});
+    show('overview');
+    setInterval(renderQuick,5000);
+  }
+  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
+})();
+</script></body>`,
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
