export const DEMO_FLATLINE_WATCHDOG_STYLE = `<style>
#flatline-watchdog{margin-top:12px}
#flatline-watchdog .watchdog-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
@media(max-width:560px){#flatline-watchdog .watchdog-grid{grid-template-columns:1fr}}
</style>`;

export const DEMO_FLATLINE_WATCHDOG_CODE = `
  function renderFlatlineWatchdog() {
    const panel = document.getElementById('positions');
    if (!panel) return;
    let root = document.getElementById('flatline-watchdog');
    if (!root) {
      root = document.createElement('section');
      root.id = 'flatline-watchdog';
      panel.appendChild(root);
    }

    const now = Date.now();
    const openCount = Array.isArray(strategies) ? strategies.filter((strategy) => strategy && strategy.position).length : 0;
    const allTrades = Array.isArray(strategies)
      ? strategies.flatMap((strategy) => Array.isArray(strategy && strategy.trades) ? strategy.trades : [])
      : [];
    const tradeTimestamps = allTrades.map((trade) => Number(trade && trade.timestamp)).filter((value) => Number.isFinite(value) && value > 0);
    const buyTimestamps = allTrades.filter((trade) => trade && trade.side === 'buy').map((trade) => Number(trade.timestamp)).filter((value) => Number.isFinite(value) && value > 0);
    const sellTimestamps = allTrades.filter((trade) => trade && trade.side === 'sell').map((trade) => Number(trade.timestamp)).filter((value) => Number.isFinite(value) && value > 0);
    const analysisTimestamps = Array.isArray(strategies)
      ? strategies.flatMap((strategy) => [strategy && strategy.lastSuccessfulAt, strategy && strategy.lastAttemptAt]).map(Number).filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const lastTradeAt = tradeTimestamps.length ? Math.max(...tradeTimestamps) : null;
    const lastBuyAt = buyTimestamps.length ? Math.max(...buyTimestamps) : null;
    const lastSellAt = sellTimestamps.length ? Math.max(...sellTimestamps) : null;
    const lastAnalysisAt = analysisTimestamps.length ? Math.max(...analysisTimestamps) : null;
    const hoursSinceTrade = lastTradeAt ? Math.max(0, (now - lastTradeAt) / 3600000) : null;
    const coverage = lab.marketCoverageAudit || lab.coverageAudit || demo.marketCoverageAudit || null;
    const activity = coverage && coverage.activity ? coverage.activity : {};
    const errors = Number(activity.errorsLast12h || activity.errors || 0);
    const stale = Number(activity.staleStrategies || 0);
    const decisions = coverage && coverage.currentDecisionFunnel
      ? Object.values(coverage.currentDecisionFunnel).reduce((sum, value) => sum + Number(value || 0), 0)
      : 0;
    const thresholdHours = 6;
    const breached = openCount === 0 && hoursSinceTrade !== null && hoursSinceTrade >= thresholdHours;
    const unexplained = breached && (errors > 0 || stale > 0 || decisions === 0);
    const status = openCount > 0 ? 'NORMAL' : unexplained ? 'ALERTA DE BLOQUEO' : breached ? 'PLANO PROLONGADO EXPLICADO' : 'VIGILANDO';
    const statusClass = unexplained ? 'bad' : breached ? 'warn' : 'ok';
    const ageText = (timestamp) => {
      if (!timestamp) return 'Sin registro';
      const minutes = Math.max(0, Math.floor((now - timestamp) / 60000));
      if (minutes < 1) return 'hace menos de 1 min';
      if (minutes < 60) return 'hace ' + minutes + ' min';
      const hours = Math.floor(minutes / 60);
      const remainder = minutes % 60;
      return 'hace ' + hours + ' h' + (remainder ? ' ' + remainder + ' min' : '');
    };

    root.innerHTML = '<div class="head"><div><h3 class="mini-title">Actividad real del laboratorio</h3><div class="sub">Separa operaciones PAPER de ciclos de análisis para no reiniciar falsamente el reloj.</div></div><span class="status ' + statusClass + '">' + status + '</span></div>' +
      '<div class="watchdog-grid">' +
      '<div class="metric"><span>Última operación PAPER</span><strong>' + ageText(lastTradeAt) + '</strong></div>' +
      '<div class="metric"><span>Última compra</span><strong>' + ageText(lastBuyAt) + '</strong></div>' +
      '<div class="metric"><span>Último cierre</span><strong>' + ageText(lastSellAt) + '</strong></div>' +
      '<div class="metric"><span>Último análisis del motor</span><strong>' + ageText(lastAnalysisAt) + '</strong></div>' +
      '<div class="metric"><span>Umbral sin operaciones</span><strong>' + thresholdHours + ' h</strong></div>' +
      '<div class="metric"><span>Decisiones clasificadas</span><strong>' + decisions + '</strong></div>' +
      '</div>' +
      '<div class="banner ' + statusClass + '"><b>' + status + '.</b> ' +
      (openCount > 0
        ? 'Existen posiciones PAPER abiertas.'
        : unexplained
          ? 'Han pasado al menos ' + thresholdHours + ' horas desde la última operación y además faltan decisiones clasificadas o existen errores/estrategias estancadas.'
          : breached
            ? 'Han pasado al menos ' + thresholdHours + ' horas desde la última operación, pero el motor continúa analizando y el embudo explica los descartes.'
            : 'El motor continúa analizando; el reloj de operaciones todavía no supera el umbral.') +
      ' LIVE y órdenes reales permanecen bloqueados.</div>';
  }

  const originalRenderZeroPositionDiagnostics = typeof renderZeroPositionDiagnostics === 'function' ? renderZeroPositionDiagnostics : null;
  if (originalRenderZeroPositionDiagnostics) {
    renderZeroPositionDiagnostics = function () {
      originalRenderZeroPositionDiagnostics();
      renderFlatlineWatchdog();
    };
  }
  window.addEventListener('load', () => setTimeout(renderFlatlineWatchdog, 900));
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.getAttribute('data-view') === 'positions' || target.id === 'refresh')) setTimeout(renderFlatlineWatchdog, 350);
  });
`;
