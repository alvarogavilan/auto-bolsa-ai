export const DEMO_LIVE_PRICES_SCRIPT = `<script>
(() => {
  const POLL_MS = 2500;
  const STATE_REFRESH_MS = 15000;
  let latestLab = null;
  let timer = null;
  let stateTimer = null;
  let lastPositionSignature = null;

  const num = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
  const eur = (value) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 5 }).format(num(value));
  const pct = (value) => new Intl.NumberFormat('es-ES', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(num(value));

  function liveStrategies() {
    const strategies = Array.isArray(latestLab?.state?.strategies) ? latestLab.state.strategies : [];
    return strategies.filter((strategy) => strategy && strategy.position && strategy.pairKey);
  }

  function positionSignature(strategies) {
    return strategies
      .map((strategy) => [strategy.symbol, strategy.pairKey, num(strategy.position?.entryTime), num(strategy.position?.quantity)].join(':'))
      .sort()
      .join('|');
  }

  function ensureLiveHeader() {
    const panel = document.getElementById('positions');
    if (!panel) return null;
    let node = document.getElementById('live-price-status');
    if (!node) {
      node = document.createElement('div');
      node.id = 'live-price-status';
      node.className = 'banner warn';
      node.innerHTML = '<b>Precio vivo Kraken:</b> preparando ticker…';
      panel.prepend(node);
    }
    return node;
  }

  function findPositionCard(symbol) {
    const cards = [...document.querySelectorAll('#positions .item')];
    return cards.find((card) => card.querySelector('h3')?.textContent?.trim() === symbol) || null;
  }

  function ensureMetric(card, key, label) {
    let node = card.querySelector('[data-live-key="' + key + '"]');
    if (!node) {
      const grid = card.querySelector('.kvs');
      if (!grid) return null;
      node = document.createElement('div');
      node.className = 'kv';
      node.setAttribute('data-live-key', key);
      node.innerHTML = '<span>' + label + '</span><strong>—</strong>';
      grid.prepend(node);
    }
    return node.querySelector('strong');
  }

  async function fetchTicker(pairKey) {
    const url = 'https://api.kraken.com/0/public/Ticker?pair=' + encodeURIComponent(pairKey);
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) throw new Error('Kraken HTTP ' + response.status);
    const payload = await response.json();
    if (Array.isArray(payload.error) && payload.error.length) throw new Error(payload.error.join(', '));
    const ticker = Object.values(payload.result || {})[0];
    if (!ticker) throw new Error('Ticker vacío');
    const bid = num(Array.isArray(ticker.b) ? ticker.b[0] : 0);
    const ask = num(Array.isArray(ticker.a) ? ticker.a[0] : 0);
    const last = num(Array.isArray(ticker.c) ? ticker.c[0] : 0);
    if (!(bid > 0)) throw new Error('Bid no disponible');
    return { bid, ask, last };
  }

  function updateCard(strategy, ticker) {
    const card = findPositionCard(strategy.symbol);
    if (!card) return null;
    const position = strategy.position || {};
    const quantity = num(position.quantity);
    const cost = num(position.costEur);
    const value = quantity * ticker.bid;
    const openPnl = value - cost;
    const openPct = cost > 0 ? openPnl / cost : 0;
    const priceNode = ensureMetric(card, 'price', 'Precio vivo bid');
    const valueNode = ensureMetric(card, 'value', 'Valor liquidable vivo');
    const pnlNode = ensureMetric(card, 'pnl', 'G/P abierta viva');
    const spreadNode = ensureMetric(card, 'spread', 'Spread vivo');
    const updatedNode = ensureMetric(card, 'updated', 'Ticker actualizado');
    if (priceNode) priceNode.textContent = eur(ticker.bid);
    if (valueNode) valueNode.textContent = eur(value);
    if (pnlNode) {
      pnlNode.textContent = eur(openPnl) + ' · ' + pct(openPct);
      pnlNode.className = openPnl > 0 ? 'positive' : openPnl < 0 ? 'negative' : '';
    }
    if (spreadNode) spreadNode.textContent = ticker.ask > 0 ? pct((ticker.ask - ticker.bid) / ticker.bid) : '—';
    const updatedAt = Date.now();
    if (updatedNode) updatedNode.textContent = new Date(updatedAt).toLocaleTimeString('es-ES') + ' · cada 2,5 s';
    card.setAttribute('data-live-updated', String(updatedAt));
    return { value, cost, openPnl };
  }

  function updateSummary(liveRows, expectedOpenPositions) {
    if (!liveRows.length || liveRows.length !== expectedOpenPositions) return false;
    const metrics = [...document.querySelectorAll('#summary .metric')];
    const byLabel = (label) => metrics.find((node) => node.querySelector('span')?.textContent?.trim() === label)?.querySelector('strong');
    const strategies = Array.isArray(latestLab?.state?.strategies) ? latestLab.state.strategies : [];
    const initial = strategies.reduce((sum, item) => sum + num(item.initialCashEur), 0);
    const scale = initial > 0 ? 50 / initial : 1;
    const cash = strategies.reduce((sum, item) => sum + num(item.cashEur), 0) * scale;
    const liveValue = liveRows.reduce((sum, row) => sum + row.value, 0) * scale;
    const investedCost = liveRows.reduce((sum, row) => sum + row.cost, 0) * scale;
    const account = cash + liveValue;
    const totalPnl = account - 50;
    const accountNode = byLabel('Valor de cuenta');
    const cashNode = byLabel('Saldo disponible');
    const investedNode = byLabel('Capital invertido');
    const totalNode = byLabel('PnL total');
    if (accountNode) {
      accountNode.textContent = eur(account);
      accountNode.className = totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : '';
    }
    if (cashNode) cashNode.textContent = eur(cash);
    if (investedNode) investedNode.textContent = eur(investedCost);
    if (totalNode) {
      totalNode.textContent = eur(totalPnl) + ' · ' + pct(totalPnl / 50);
      totalNode.className = totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : '';
    }
    return true;
  }

  async function pollLivePrices() {
    const status = ensureLiveHeader();
    const strategies = liveStrategies();
    if (!strategies.length) {
      if (status) status.innerHTML = '<b>Precio vivo Kraken:</b> sin posiciones abiertas.';
      return;
    }
    const results = await Promise.allSettled(strategies.map(async (strategy) => ({ strategy, ticker: await fetchTicker(strategy.pairKey) })));
    const liveRows = [];
    let failures = 0;
    for (const result of results) {
      if (result.status !== 'fulfilled') { failures += 1; continue; }
      const row = updateCard(result.value.strategy, result.value.ticker);
      if (row) liveRows.push(row);
      else failures += 1;
    }
    const summaryUpdated = updateSummary(liveRows, strategies.length);
    if (status) {
      const now = new Date().toLocaleTimeString('es-ES');
      status.className = 'banner ' + (failures ? 'warn' : 'safe');
      status.innerHTML = '<b>Precio vivo Kraken:</b> ' + liveRows.length + '/' + strategies.length + ' posición(es) actualizadas a las ' + now + ' · refresco cada ' + (POLL_MS / 1000).toFixed(1) + ' s' + (failures ? ' · ' + failures + ' fallo(s); el resumen conserva el último valor completo' : '') + '. El PnL usa el bid, es decir, el precio conservador de salida.' + (summaryUpdated ? '' : ' No se recalcula la cuenta con datos parciales.');
    }
  }

  async function refreshState() {
    try {
      const response = await fetch('/api/lab', { cache: 'no-store' });
      if (!response.ok) throw new Error('Lab HTTP ' + response.status);
      const nextLab = await response.json();
      const nextStrategies = Array.isArray(nextLab?.state?.strategies) ? nextLab.state.strategies.filter((strategy) => strategy?.position && strategy?.pairKey) : [];
      const nextSignature = positionSignature(nextStrategies);
      if (lastPositionSignature !== null && nextSignature !== lastPositionSignature) {
        const url = new URL(window.location.href);
        url.searchParams.set('state', String(Date.now()));
        window.location.replace(url.toString());
        return;
      }
      latestLab = nextLab;
      lastPositionSignature = nextSignature;
      await pollLivePrices();
    } catch (error) {
      const status = ensureLiveHeader();
      if (status) {
        status.className = 'banner bad';
        status.innerHTML = '<b>Precio vivo degradado:</b> ' + String(error instanceof Error ? error.message : error) + '. No afecta a PAPER ni habilita LIVE.';
      }
    }
  }

  function start() {
    if (timer) clearInterval(timer);
    if (stateTimer) clearInterval(stateTimer);
    refreshState();
    timer = setInterval(pollLivePrices, POLL_MS);
    stateTimer = setInterval(refreshState, STATE_REFRESH_MS);
  }

  window.addEventListener('load', () => setTimeout(start, 600));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') start();
  });
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.id === 'refresh' || target.getAttribute('data-view') === 'positions')) setTimeout(refreshState, 250);
  });
})();
</script>`;
