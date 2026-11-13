/**
 * Pantalla «Radar Mundial»: medios, redes, empresas y mercados globales.
 * Todo el contenido dinámico se escribe con textContent.
 */
const STYLE = `
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--ink:#12151a;--mute:#5d6673;--line:#dfe3e8;--up:#0a8f4d;--down:#d12c3a}
@media(prefers-color-scheme:dark){:root{--bg:#0b0d10;--card:#151920;--ink:#f3f5f8;--mute:#9aa4b2;--line:#28303b;--up:#35d07f;--down:#ff6b76}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:760px;margin:0 auto;padding:12px 16px 40px}
h1{font-size:26px;margin:8px 0 2px;letter-spacing:-.02em}.sub{color:var(--mute);font-size:14px;margin:0 0 14px}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:16px;margin:0 0 14px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin:0 0 10px}
.row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:15px}.row:first-of-type{border-top:0}
.row>span:last-child{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.up{color:var(--up)}.down{color:var(--down)}.small{font-size:13px;color:var(--mute)}
.pulse{padding:10px 0;border-top:1px solid var(--line)}.pulse:first-of-type{border-top:0}
.pulse b{font-size:16px}.pulse .head{display:flex;justify-content:space-between;gap:8px}
.hl{color:inherit;display:block;font-size:14px;margin:5px 0;overflow-wrap:anywhere}
.grp{font-size:12px;color:var(--mute);margin:10px 0 2px;text-transform:uppercase;letter-spacing:.05em}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:13px}
.chip.bad{color:var(--down)}a.link{color:var(--mute);font-size:13px;margin-right:14px}
.note{font-size:13px;color:var(--mute);border-left:3px solid var(--line);padding-left:10px;margin:0 0 14px}
`;

const SCRIPT = `
function $(id){return document.getElementById(id)}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
function link(title,href){var ok=href&&/^https:/.test(href);var a=el(ok?'a':'span','hl',title);if(ok){a.href=href;a.target='_blank';a.rel='noopener noreferrer'}return a}
function pct(v){return (v>=0?'+':'')+v.toFixed(2).replace('.',',')+' %'}
function num(v){return v.toLocaleString('es-ES',{maximumFractionDigits:v>=100?2:4})}
function cls(v){return v>0?'up':v<0?'down':'small'}
function radar(){fetch('/api/radar').then(function(r){return r.json()}).then(function(d){
  $('sub').textContent=d.sourcesAvailable+' de '+d.sourcesConfigured+' fuentes gratuitas respondiendo · '+d.itemsAnalysed+' titulares analizados · '+new Date(d.generatedAt).toLocaleTimeString('es-ES');
  var p=$('pulses');p.textContent='';
  d.pulses.forEach(function(x){var b=el('div','pulse');var h=el('div','head');h.appendChild(el('b','',x.label));var v=el('span',cls(x.verdict==='Sin datos'?0:x.tone),x.verdict+(x.verdict==='Sin datos'?'':' ('+(x.tone>0?'+':'')+x.tone+')'));h.appendChild(v);b.appendChild(h);
    b.appendChild(el('div','small',x.mediaMentions+' en medios'+(x.mediaTone===null?'':' (tono '+x.mediaTone+')')+' · '+x.socialMentions+' en redes'+(x.socialTone===null?'':' (tono '+x.socialTone+')')));
    x.headlines.forEach(function(n){b.appendChild(link((n.tone>0?'▲ ':n.tone<0?'▼ ':'• ')+n.title+' — '+n.source,n.link))});p.appendChild(b)});
  var s=$('social');s.textContent='';
  if(d.fearGreed){var r=el('div','row');r.appendChild(el('span','','Miedo/Codicia crypto'));r.appendChild(el('span',d.fearGreed.value>=55?'up':d.fearGreed.value<=44?'down':'small',d.fearGreed.value+' · '+d.fearGreed.label));s.appendChild(r)}
  [['Acciones más comentadas (Stocktwits)',d.trending.stocks],['Monedas en tendencia (CoinGecko)',d.trending.coins]].forEach(function(t){if(!t[1].length)return;s.appendChild(el('div','grp',t[0]));var c=el('div','chips');t[1].forEach(function(k){c.appendChild(el('span','chip',k))});s.appendChild(c)});
  if(!s.childNodes.length)s.appendChild(el('div','small','Las fuentes de redes no responden ahora.'));
  var c=$('companies');c.textContent='';
  d.companies.forEach(function(x){var r=el('div','row');var l=el('span');l.appendChild(el('b','',x.name+' · '+x.mentions));l.appendChild(link(x.headline,x.link));l.className='news';r.appendChild(l);r.appendChild(el('span',cls(x.tone),x.tone>0?'Positivo':x.tone<0?'Negativo':'Neutro'));c.appendChild(r)});
  if(!d.companies.length)c.appendChild(el('div','small','Sin menciones de empresas ahora.'));
  var f=$('filings');f.textContent='';d.filings.forEach(function(x){var r=el('div','news');r.appendChild(link(x.title,x.link));f.appendChild(r)});
  if(!d.filings.length)f.appendChild(el('div','small','Sin hechos relevantes recientes.'));
  var n=$('latest');n.textContent='';d.latest.forEach(function(x){var r=el('div','news');r.appendChild(link((x.tone>0?'▲ ':x.tone<0?'▼ ':'• ')+x.title+' — '+x.source,x.link));n.appendChild(r)});
  var st=$('status');st.textContent='';d.sourceStatus.forEach(function(x){st.appendChild(el('span','chip'+(x.available?'':' bad'),(x.available?'✓ ':'✕ ')+x.label))});
}).catch(function(){$('sub').textContent='No se pudo cargar el radar. Reintenta en un minuto.'})}
function board(){fetch('/api/world-markets').then(function(r){return r.json()}).then(function(d){var m=$('board');m.textContent='';
  if(!d.available){m.appendChild(el('div','small','El tablero mundial no responde ahora.'));return}
  var g='';d.quotes.forEach(function(q){if(q.group!==g){g=q.group;m.appendChild(el('div','grp',g))}var r=el('div','row');r.appendChild(el('span','',q.label));r.appendChild(el('span',q.changePct===null?'':cls(q.changePct),num(q.price)+(q.changePct===null?'':'  '+pct(q.changePct))));m.appendChild(r)})}).catch(function(){})}
radar();board();setInterval(radar,180000);setInterval(board,60000);
`;

export function radarScreen(): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Auto Bolsa · Radar Mundial</title><style>${STYLE}</style></head><body><main>
<p><a class="link" href="/">← Orden ahora</a></p>
<h1>Radar Mundial</h1><p id="sub" class="sub">Cargando fuentes…</p>
<p class="note">Esto es información, no una orden. El tono de medios y redes no predice el precio; la orden a ejecutar está siempre en la pantalla principal.</p>
<section class="card"><h2>Pulso por tema (medios + redes)</h2><div id="pulses"></div></section>
<section class="card"><h2>Mercados del mundo · variación de hoy</h2><div id="board"></div></section>
<section class="card"><h2>Redes sociales</h2><div id="social"></div></section>
<section class="card"><h2>Empresas más mencionadas</h2><div id="companies"></div></section>
<section class="card"><h2>Hechos relevantes oficiales (SEC 8-K)</h2><div id="filings"></div></section>
<section class="card"><h2>Últimos titulares</h2><div id="latest"></div></section>
<section class="card"><h2>Estado de las fuentes</h2><div id="status" class="chips"></div></section>
</main><script>${SCRIPT}</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
}
