export const DEMO_PERFORMANCE_FORENSICS_CODE = String.raw`
(() => {
  function performanceForensics() {
    const closed = typeof pairs === 'function' ? pairs().filter(item => item && item.sell) : [];
    const rows = closed.map(item => {
      const pnl = n(item.sell && item.sell.pnlEur);
      const evidenceComplete = item.buy && item.buy.evidenceVersion === 'paper-trade-evidence-v1'
        && item.sell && item.sell.evidenceVersion === 'paper-trade-evidence-v1';
      return {
        lane: item.s && item.s.lane ? item.s.lane : 'unknown',
        symbol: item.s && (item.s.symbol || item.s.id) ? (item.s.symbol || item.s.id) : '—',
        pnl,
        reason: String(item.sell && item.sell.reason || 'Sin motivo persistido'),
        evidenceComplete,
      };
    });
    const wins = rows.filter(row => row.pnl > 0);
    const losses = rows.filter(row => row.pnl < 0);
    const flats = rows.filter(row => row.pnl === 0);
    const net = rows.reduce((sum, row) => sum + row.pnl, 0);
    const grossProfit = wins.reduce((sum, row) => sum + row.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.pnl, 0));
    const avgWin = wins.length ? grossProfit / wins.length : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const expectancy = rows.length ? net / rows.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const complete = rows.filter(row => row.evidenceComplete);
    const historical = rows.filter(row => !row.evidenceComplete);
    const grouped = new Map();
    rows.forEach(row => {
      const key = row.lane;
      const current = grouped.get(key) || { closed: 0, wins: 0, losses: 0, pnl: 0 };
      current.closed += 1;
      current.wins += row.pnl > 0 ? 1 : 0;
      current.losses += row.pnl < 0 ? 1 : 0;
      current.pnl += row.pnl;
      grouped.set(key, current);
    });
    const exitReasons = new Map();
    rows.forEach(row => {
      const reason = row.reason.toLowerCase();
      const key = reason.includes('stop') ? 'Stop loss'
        : reason.includes('tiempo máximo') ? 'Tiempo máximo'
        : reason.includes('rsi') ? 'Salida RSI'
        : reason.includes('cruce') ? 'Cruce bajista'
        : reason.includes('objetivo') || reason.includes('take profit') ? 'Objetivo'
        : 'Otros';
      const current = exitReasons.get(key) || { count: 0, pnl: 0 };
      current.count += 1;
      current.pnl += row.pnl;
      exitReasons.set(key, current);
    });
    return { rows, wins, losses, flats, net, grossProfit, grossLoss, avgWin, avgLoss, expectancy, profitFactor, complete, historical, grouped, exitReasons };
  }

  function forensicPanel() {
    const report = performanceForensics();
    const winRate = report.rows.length ? report.wins.length / report.rows.length : 0;
    const unacceptable = report.rows.length > 0 && (report.net <= 0 || winRate < 0.4 || report.profitFactor < 1);
    const factor = Number.isFinite(report.profitFactor) ? report.profitFactor.toFixed(2) : '∞';
    const laneRows = [...report.grouped.entries()].map(([laneId, value]) =>
      '<div class="item"><b>' + esc(lane(laneId)) + '</b><div class="sub">'
      + value.closed + ' cerradas · ' + value.wins + ' G / ' + value.losses + ' P · PnL ' + eur(value.pnl)
      + '</div></div>'
    ).join('');
    const reasonRows = [...report.exitReasons.entries()].sort((a, b) => b[1].count - a[1].count).map(([reason, value]) =>
      '<div class="item"><b>' + esc(reason) + '</b><div class="sub">'
      + value.count + ' cierre(s) · PnL ' + eur(value.pnl) + '</div></div>'
    ).join('');
    return '<article id="paper-performance-forensics" class="item">'
      + '<h3 class="mini-title">Diagnóstico forense del rendimiento</h3>'
      + '<div class="banner ' + (unacceptable ? 'bad' : 'safe') + '"><b>'
      + (unacceptable ? 'Muestra negativa: no apta para LIVE.' : 'Muestra provisional favorable.')
      + '</b> No se alteran operaciones ni se ocultan pérdidas.</div>'
      + '<div class="grid">'
      + metric('Operaciones cerradas', report.rows.length)
      + metric('Ganadas / perdidas', report.wins.length + ' / ' + report.losses.length)
      + metric('Tasa de acierto', pct(winRate), winRate >= 0.5 ? 'positive' : 'negative')
      + metric('PnL neto cerrado', eur(report.net), cls(report.net))
      + metric('Expectativa por operación', eur(report.expectancy), cls(report.expectancy))
      + metric('Profit factor', factor, report.profitFactor >= 1 ? 'positive' : 'negative')
      + metric('Ganancia media', eur(report.avgWin), report.avgWin > 0 ? 'positive' : '')
      + metric('Pérdida media', eur(report.avgLoss), report.avgLoss > 0 ? 'negative' : '')
      + metric('Evidencia completa nueva', report.complete.length)
      + metric('Históricas / legado', report.historical.length)
      + '</div>'
      + '<div class="section-stack" style="margin-top:12px"><div><h3 class="mini-title">Por carril</h3><div class="list">'
      + (laneRows || '<div class="empty">Sin cierres.</div>') + '</div></div>'
      + '<div><h3 class="mini-title">Por causa de salida</h3><div class="list">'
      + (reasonRows || '<div class="empty">Sin cierres.</div>') + '</div></div></div>'
      + '<div class="banner warn"><b>Interpretación:</b> las operaciones históricas anteriores a la evidencia v1 se conservan, pero se separan de las operaciones nuevas para evaluar si el motor actual mejora de verdad.</div>'
      + '</article>';
  }

  const baseRenderSummaryForensics = typeof renderSummary === 'function' ? renderSummary : null;
  if (baseRenderSummaryForensics) {
    renderSummary = function renderSummaryWithForensics() {
      baseRenderSummaryForensics();
      const previous = document.getElementById('paper-performance-forensics-summary');
      if (previous) previous.remove();
      const report = performanceForensics();
      const rate = report.rows.length ? report.wins.length / report.rows.length : 0;
      summary.insertAdjacentHTML('beforeend', '<div id="paper-performance-forensics-summary" class="banner '
        + (report.rows.length && (report.net <= 0 || rate < 0.4) ? 'bad' : 'warn') + '"><b>Calidad cerrada:</b> '
        + report.rows.length + ' operaciones · ' + report.wins.length + ' ganadas · ' + report.losses.length
        + ' perdidas · acierto ' + pct(rate) + ' · expectativa ' + eur(report.expectancy)
        + '. Consulte Rendimiento para el desglose histórico frente al motor actual.</div>');
    };
  }

  const baseRenderPerformanceForensics = typeof renderPerformance === 'function' ? renderPerformance : null;
  if (baseRenderPerformanceForensics) {
    renderPerformance = function renderPerformanceWithForensics() {
      baseRenderPerformanceForensics();
      const previous = document.getElementById('paper-performance-forensics');
      if (previous) previous.remove();
      performance.insertAdjacentHTML('afterbegin', forensicPanel());
    };
  }
})();`;
