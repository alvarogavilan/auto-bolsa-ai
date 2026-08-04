export const DEMO_MARKET_UNIVERSE_STYLE = String.raw`
<style>
#market-universe-panel{margin:16px 0;padding:16px;border:1px solid #315e91;border-radius:16px;background:rgba(17,34,58,.92)}
#market-universe-panel h2{margin:0 0 10px}.market-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.market-card{padding:10px;border-radius:12px;background:rgba(7,11,24,.58);border:1px solid rgba(255,255,255,.09)}.market-card span{display:block;color:#aeb8d4;font-size:12px}.market-card strong{display:block;margin-top:4px}.market-list{margin-top:12px;display:grid;gap:8px}.market-row{padding:10px;border-radius:12px;background:rgba(7,11,24,.45)}.market-ok{color:#5ee6a8}.market-warn{color:#ffd86b}.market-note{margin-top:10px;color:#c5cde3;font-size:13px}
</style>`;

export const DEMO_MARKET_UNIVERSE_CODE = String.raw`
(() => {
  const marketEsc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const marketPct = value => Number.isFinite(Number(value)) ? (Number(value) * 100).toFixed(3) + ' %' : '—';
  function ensureMarketPanel(){
    let panel=document.getElementById('market-universe-panel');
    if(panel)return panel;
    panel=document.createElement('section');panel.id='market-universe-panel';
    panel.innerHTML='<h2>Mercados analizados</h2><div class="market-note">Cargando universo EUR de Kraken…</div>';
    const audit=document.getElementById('audit');const summary=document.getElementById('summary');
    (audit||summary||document.body).append(panel);return panel;
  }
  function candidateRow(candidate){
    const lanes=[candidate.fastEligible?'rápida':'',candidate.intradayEligible?'intradía':'',candidate.swingEligible?'swing':''].filter(Boolean).join(', ');
    const reasons=Array.isArray(candidate.exclusionReasons)&&candidate.exclusionReasons.length?candidate.exclusionReasons.join(', '):'sin bloqueos de mercado';
    return '<div class="market-row"><strong>'+marketEsc(candidate.symbol)+'</strong> · puntuación '+marketEsc(candidate.score)
      +' · spread '+marketPct(candidate.spreadPct)+' · carriles: '+marketEsc(lanes||'ninguno')
      +'<div class="market-note">'+marketEsc(reasons)+'</div></div>';
  }
  function renderMarketUniverse(data){
    const panel=ensureMarketPanel();
    if(!data||data.available===false){panel.innerHTML='<h2>Mercados analizados</h2><div class="market-note market-warn">No se pudo cargar el universo: '+marketEsc(data&&data.error)+'</div>';return;}
    const candidates=Array.isArray(data.candidates)?data.candidates:[];
    const eligible=candidates.filter(c=>c.fastEligible||c.intradayEligible||c.swingEligible);
    const nearest=[...candidates].sort((a,b)=>Number(b.score||0)-Number(a.score||0)).slice(0,8);
    panel.innerHTML='<h2>Universo real de mercados EUR</h2><div class="market-grid">'
      +'<div class="market-card"><span>Descubiertos</span><strong>'+marketEsc(data.eurMarketsDiscovered||0)+'</strong></div>'
      +'<div class="market-card"><span>Online</span><strong>'+marketEsc(data.onlineEurMarkets||0)+'</strong></div>'
      +'<div class="market-card"><span>Compatibles con capital</span><strong>'+marketEsc(data.capitalCompatibleMarkets||0)+'</strong></div>'
      +'<div class="market-card"><span>Elegibles ahora</span><strong class="'+(eligible.length?'market-ok':'market-warn')+'">'+eligible.length+'</strong></div>'
      +'</div><div class="market-note">Último mapa: '+new Date(Number(data.generatedAt||Date.now())).toLocaleString('es-ES')+'. Se muestran los candidatos más cercanos; una operación solo se abre si supera además señal, costes, tesorería y riesgo.</div>'
      +'<div class="market-list">'+nearest.map(candidateRow).join('')+'</div>';
  }
  async function refreshMarketUniverse(){try{const r=await fetch('/api/markets',{cache:'no-store'});renderMarketUniverse(await r.json());}catch(error){renderMarketUniverse({available:false,error:error&&error.message?error.message:String(error)});}}
  refreshMarketUniverse();setInterval(refreshMarketUniverse,60000);
})();`;
