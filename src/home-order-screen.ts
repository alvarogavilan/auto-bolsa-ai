import { APP_HEAD_TAGS } from "./app-install";
/**
 * Pantalla principal: «la orden a ejecutar ahora».
 *
 * - Consulta /api/order-now cada 5 s (precio vivo de la plataforma de ejecución).
 * - Si pasan más de 20 s sin una respuesta válida, tapa la orden con un aviso
 *   rojo: una orden vieja es peor que ninguna.
 * - Todo el contenido dinámico se escribe con textContent (sin HTML inyectado).
 */
export const ORDER_POLL_MS = 5_000;
export const CLIENT_STALE_MS = 20_000;

const STYLE = `
:root{color-scheme:light dark;--bg:#f4f5f7;--card:#fff;--ink:#12151a;--mute:#5d6673;--line:#dfe3e8;--buy:#0a8f4d;--sell:#d12c3a;--hold:#2f6fde;--wait:#6b7280;--warn:#b45309}
@media(prefers-color-scheme:dark){:root{--bg:#0b0d10;--card:#151920;--ink:#f3f5f8;--mute:#9aa4b2;--line:#28303b;--buy:#35d07f;--sell:#ff6b76;--hold:#6ea4ff;--wait:#a3acb9;--warn:#fbbf24}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-text-size-adjust:100%}
main{max-width:640px;margin:0 auto;padding:12px 16px 40px}
.top{display:flex;justify-content:space-between;align-items:center;font-size:13px;color:var(--mute);padding:6px 2px 10px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--buy);margin-right:6px}.dot.bad{background:var(--sell)}
.card{background:var(--card);border:1px solid var(--line);border-radius:18px;padding:18px;margin:0 0 14px}
.order{border-width:2px;position:relative}.order.buy{border-color:var(--buy)}.order.sell{border-color:var(--sell)}.order.hold{border-color:var(--hold)}.order.wait{border-color:var(--line)}
h1{font-size:30px;line-height:1.1;margin:0 0 4px;letter-spacing:-.02em}.buy h1{color:var(--buy)}.sell h1{color:var(--sell)}.hold h1{color:var(--hold)}.wait h1{color:var(--wait)}
.sub{color:var(--mute);font-size:14px;margin:0 0 12px}
.count{font-variant-numeric:tabular-nums;font-size:22px;font-weight:700;margin:8px 0 12px}
ol{margin:0;padding-left:22px}li{font-size:17px;line-height:1.35;margin:7px 0}
.warn{margin:12px 0 0;padding:0;list-style:none}.warn li{font-size:14px;color:var(--warn);margin:4px 0}
.reason{font-size:14px;color:var(--mute);margin:12px 0 0}
.stale{display:none;position:absolute;inset:0;background:var(--card);border-radius:16px;padding:18px;flex-direction:column;justify-content:center;text-align:center}
.stale b{color:var(--sell);font-size:24px}.is-stale .stale{display:flex}
.btn{display:block;text-align:center;margin-top:14px;padding:14px;border-radius:14px;background:var(--ink);color:var(--bg);font-weight:700;text-decoration:none;font-size:17px}
h2{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:var(--mute);margin:0 0 10px}
.row{display:flex;justify-content:space-between;gap:10px;padding:8px 0;border-top:1px solid var(--line);font-size:15px}.row:first-of-type{border-top:0}
.row span:last-child{font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap}
.up{color:var(--buy)}.down{color:var(--sell)}.small{font-size:13px;color:var(--mute)}
.mini h3{margin:0 0 6px;font-size:17px}.mini.buy h3{color:var(--buy)}.mini.sell h3{color:var(--sell)}.mini.hold h3{color:var(--hold)}
a.link{color:var(--mute);font-size:13px;margin-right:14px}
`;

const SCRIPT = `
var POLL=${ORDER_POLL_MS},STALE=${CLIENT_STALE_MS},last=0,data=null;
function $(id){return document.getElementById(id)}
function el(tag,cls,text){var n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n}
function eur(v){return v.toLocaleString('es-ES',{minimumFractionDigits:2,maximumFractionDigits:v>=1000?2:v>=1?4:6})+' €'}
function pct(v){return (v>=0?'+':'')+v.toFixed(2).replace('.',',')+' %'}
function biasWord(b){return b==='long'?'Subirá':b==='short'?'Bajará':'Neutral'}
function fill(parent,items,tag){parent.textContent='';items.forEach(function(t){parent.appendChild(el(tag,'',t))})}
function render(){
  var d=data;if(!d)return;var p=d.primary,box=$('order');
  box.className='card order '+p.action;
  $('headline').textContent=(p.action==='buy'?'🟢 ':p.action==='sell'?'🔴 ':p.action==='hold'?'🔵 ':'⏸ ')+p.headline;
  var sub=[];if(p.alertId)sub.push('Alerta '+p.alertId);if(p.priceEur!==null&&p.action!=='buy')sub.push('Precio ahora '+eur(p.priceEur));if(p.resultPct!==null)sub.push('Resultado '+pct(p.resultPct));
  $('sub').textContent=sub.join(' · ');
  fill($('steps'),p.steps,'li');fill($('warnings'),p.warnings.map(function(w){return '⚠️ '+w}),'li');
  $('reason').textContent=[p.reason?'Motivo: '+p.reason:'',p.evidence?'Historial simulado: '+p.evidence:''].filter(Boolean).join('  ·  ');
  $('kraken').style.display=(p.action==='buy'||p.action==='sell')?'block':'none';if(d.venue){$('kraken').textContent='Abrir '+d.venue.name;if(/^https:/.test(d.venue.url))$('kraken').href=d.venue.url;$('marketTitle').textContent='Mercado en vivo ('+d.venue.name+')'}
  var o=$('others');o.textContent='';
  d.others.forEach(function(c){var m=el('div','card mini '+c.action);m.appendChild(el('h3','',c.headline));var ol=el('ol');c.steps.forEach(function(s){ol.appendChild(el('li','',s))});m.appendChild(ol);o.appendChild(m)});
  var mk=$('market');mk.textContent='';
  d.market.forEach(function(m){var r=el('div','row');r.appendChild(el('span','',m.label));var v=el('span','',eur(m.bidEur)+(m.change24hPct===null?'':'  '+pct(m.change24hPct)));if(m.change24hPct!==null)v.className=m.change24hPct>=0?'up':'down';r.appendChild(v);mk.appendChild(r)});
  var tm=$('team');tm.textContent='';
  if(d.team){$('teamTitle').textContent='Tu equipo de oro · consenso '+Math.round(d.team.consensusPct)+' % · '+biasWord(d.team.bias);
    d.team.votes.forEach(function(v){var r=el('div','row');r.appendChild(el('span','',v.expert.replace(' XAU','')));var s=el('span','',biasWord(v.bias));s.className=v.bias==='long'?'up':v.bias==='short'?'down':'small';r.appendChild(s);tm.appendChild(r)});
    d.team.vetoes.concat(d.discarded).forEach(function(t){tm.appendChild(el('div','small','⛔ '+t))})}
  tick();
}
function tick(){
  var now=Date.now(),age=last?Math.round((now-last)/1000):null,stale=!last||now-last>STALE;
  $('order').classList.toggle('is-stale',stale&&!!data&&data.primary.action!=='sell');
  $('dot').className='dot'+(stale||(data&&!data.dataFresh)?' bad':'');
  $('fresh').textContent=stale?'SIN CONEXIÓN':(data&&!data.dataFresh?'Datos incompletos':'En vivo')+' · hace '+age+' s';
  var c=$('count');
  if(data&&data.primary.expiresAt){var left=Math.max(0,Math.round((data.primary.expiresAt-now)/1000));c.textContent=left>0?'Caduca en '+Math.floor(left/60)+':'+('0'+left%60).slice(-2):'CADUCADA — no compres';c.style.display='block'}else c.style.display='none';
}
function load(){fetch('/api/order-now',{cache:'no-store'}).then(function(r){if(!r.ok)throw 0;return r.json()}).then(function(j){data=j;last=Date.now();render()}).catch(function(){if(!data){$('headline').textContent='⏸ NO OPERES · sin conexión con el motor';$('sub').textContent='No se pudo cargar la orden. Se reintenta sola cada 5 segundos.'}tick()})}
function news(){fetch('/api/news-brief').then(function(r){return r.json()}).then(function(j){var n=$('news');n.textContent='';$('newsTitle').textContent='Noticias oficiales · '+j.sourcesAvailable+'/'+j.sourcesConfigured+' fuentes';
  (j.signals||[]).forEach(function(s){var r=el('div','row');var a=el(s.link&&/^https:/.test(s.link)?'a':'span','',(s.urgency==='breaking'?'🚨 ':'')+s.title);if(a.tagName==='A'){a.href=s.link;a.rel='noopener noreferrer';a.target='_blank';a.style.color='inherit'}r.appendChild(a);r.appendChild(el('span','small',s.source));n.appendChild(r)});
  if(!(j.signals||[]).length)n.appendChild(el('div','small','Sin noticias de alto impacto ahora.'))}).catch(function(){})}
function radar(){fetch('/api/radar').then(function(r){return r.json()}).then(function(j){var n=$('radar');n.textContent='';$('radarTitle').textContent='Radar mundial · '+j.sourcesAvailable+'/'+j.sourcesConfigured+' fuentes · '+j.itemsAnalysed+' titulares';
  j.pulses.filter(function(x){return ['gold','bitcoin','macro','stocks','geopolitics'].indexOf(x.topic)>=0}).forEach(function(x){var r=el('div','row');r.appendChild(el('span','',x.label+' · '+x.mentions+' menciones'));var v=el('span','',x.verdict);v.className=x.verdict==='Sin datos'||x.tone===0?'small':x.tone>0?'up':'down';r.appendChild(v);n.appendChild(r)});
  if(j.fearGreed){var r=el('div','row');r.appendChild(el('span','','Miedo/Codicia crypto'));r.appendChild(el('span','small',j.fearGreed.value+' · '+j.fearGreed.label));n.appendChild(r)}
  n.appendChild(el('div','small','Informativo: no cambia la orden.'))}).catch(function(){})}
function telegram(){fetch('/api/telegram/readiness',{cache:'no-store'}).then(function(r){return r.json()}).then(function(j){var bad=!j.configured||!j.connected||!j.chatResolved;$('tgwarn').style.display=bad?'block':'none';
  $('tgtext').textContent=!j.configured?'Falta configurar el bot de Telegram. Hasta entonces las órdenes solo aparecen en esta pantalla.':!j.connected?'El token del bot de Telegram no es válido. Hasta arreglarlo las órdenes solo aparecen en esta pantalla.':'El bot no encuentra tu chat. Abre tu bot en Telegram y pulsa «Iniciar», o añádelo al grupo o canal donde quieres los avisos. Hasta entonces las órdenes solo aparecen en esta pantalla.'}).catch(function(){})}
load();news();radar();telegram();setInterval(telegram,600000);setInterval(radar,180000);setInterval(load,POLL);setInterval(tick,1000);setInterval(news,120000);
document.addEventListener('visibilitychange',function(){if(!document.hidden)load()});
`;

export function homeOrderScreen(): Response {
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">${APP_HEAD_TAGS}<title>Auto Bolsa · Orden ahora</title><style>${STYLE}</style></head><body><main>
<div class="top"><span><span id="dot" class="dot bad"></span><span id="fresh">Conectando…</span></span><span>Auto Bolsa</span></div>
<section id="order" class="card order wait"><h1 id="headline">Cargando orden…</h1><p id="sub" class="sub"></p><div id="count" class="count" style="display:none"></div><ol id="steps"></ol><ul id="warnings" class="warn"></ul><p id="reason" class="reason"></p><a id="kraken" class="btn" style="display:none" href="https://crypto.com/app" rel="noopener noreferrer" target="_blank">Abrir Crypto.com</a>
<div class="stale"><b>NO EJECUTES</b><p>Esta pantalla no se ha actualizado en los últimos 20 segundos. Comprueba tu conexión.</p></div></section>
<section id="tgwarn" class="card" style="display:none;border-color:var(--sell)"><h2 style="color:var(--sell)">Telegram no puede avisarte</h2><p id="tgtext" style="margin:0;font-size:15px"></p></section>
<div id="others"></div>
<section class="card"><h2 id="marketTitle">Mercado en vivo</h2><div id="market"></div></section>
<section class="card"><h2 id="teamTitle">Tu equipo de oro</h2><div id="team"></div></section>
<section class="card"><h2 id="radarTitle">Radar mundial</h2><div id="radar"></div><a class="btn" style="background:transparent;color:var(--ink);border:1px solid var(--line)" href="/radar">Ver radar completo: medios, redes, empresas y mercados</a></section>
<section class="card"><h2 id="newsTitle">Noticias oficiales</h2><div id="news"></div></section>
<p><a class="link" href="/demo">Panel de simulación</a><a class="link" href="/technical">Panel técnico</a><a class="link" href="/api/signals/status">Historial de alertas</a></p>
<p class="small">Auto Bolsa no envía órdenes: las ejecutas tú. Las señales se basan en simulación y no garantizan beneficios.</p>
</main><script>${SCRIPT}</script></body></html>`;
  return new Response(html, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
