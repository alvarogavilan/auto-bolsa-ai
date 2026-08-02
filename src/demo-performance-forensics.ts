export const DEMO_PERFORMANCE_FORENSICS_CODE = String.raw`
(() => {
  const MIN_CURRENT_CLOSED_TRADES = 30;
  const MIN_CURRENT_PROFIT_FACTOR = 1.2;

  function summarizePerformance(rows) {
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
    const winRate = rows.length ? wins.length / rows.length : 0;
    return { rows, wins, losses, flats, net, grossProfit, grossLoss, avgWin, avgLoss, expectancy, profitFactor, winRate };
  }

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
    const complete = rows.filter(row => row.evidenceComplete);
    const historical = rows.filter(row => !row.evidenceComplete);
    const all = summarizePerformance(rows);
    const current = summarizePerformance(complete);
    const legacy = summarizePerformance(historical);
    const grouped = new Map();
    rows.forEach(row => {
      const key = row.lane;
      const currentLane = grouped.get(key) || { closed: 0, wins: 0, losses: 0, pnl: 0 };
      currentLane.closed += 1;
      currentLane.wins += row.pnl > 0 ? 1 : 0;
      currentLane.losses += row.pnl < 0 ? 1 : 0;
      currentLane.pnl += row.pnl;
      grouped.set(key, currentLane);
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
      const currentReason = exitReasons.get(key) || { count: 0, pnl: 0 };
      currentReason.count += 1;
      currentReason.pnl += row.pnl;
      exitReasons.set(key, currentReason);
    });
    const sampleComplete = current.rows.length >= MIN_CURRENT_CLOSED_TRADES;
    const qualityPass = sampleComplete
      && current.net > 0
      && current.expectancy > 0
      && current.profitFactor >= MIN_CURRENT_PROFIT_FACTOR;
    return { ...all, complete, historical, current, legacy, grouped, exitReasons, sampleComplete, qualityPass };
  }

  function forensicPanel() {
    const report = performanceForensics();
    const current = report.current;
    const currentFactor = Number.isFinite(current.profitFactor) ? current.profitFactor.toFixed(2) : '∞';
    const allFactor = Number.isFinite(report.profitFactor) ? report.profitFactor.toFixed(2) : '∞';
    const laneRows = [...report.grouped.entries()].map(([laneId, value]) =>
      '<div class="item"><b>' + esc(lane(laneId)) + '</b><div class="sub">'
      + value.closed + ' cerradas · ' + value.wins + ' G / ' + value.losses + ' P · PnL ' + eur(value.pnl)
      + '</div></div>'
    ).join('');
    const reasonRows = [...report.exitReasons.entries()].sort((a, b) => b[1].count - a[1].count).map(([reason, value]) =>
      '<div class="item"><b>' + esc(reason) + '</b><div class="sub">'
      + value.count + ' cierre(s) · PnL ' + eur(value.pnl) + '</div></div>'
    ).join('');
    const currentBanner = current.rows.length === 0
      ? '<div class="banner warn"><b>Motor actual todavía sin cierres evaluables.</b> Las cifras históricas no sirven para aprobar LIVE.</div>'
      : !report.sampleComplete
        ? '<div class="banner warn"><b>Muestra insuficiente: ' + current.rows.length + ' de ' + MIN_CURRENT_CLOSED_TRADES + ' cierres actuales.</b> Ningún resultado se considera favorable antes de completar la muestra mínima.</div>'
        : '<div class="banner ' + (report.qualityPass ? 'warn' : 'bad') + '"><b>'
          + (report.qualityPass ? 'Muestra mínima completada con métricas positivas; LIVE continúa bloqueado.' : 'Motor actual: muestra negativa, no apta para LIVE.')
          + '</b> Se exige expectativa positiva y profit factor mínimo ' + MIN_CURRENT_PROFIT_FACTOR.toFixed(1) + '.</div>';
    return '<article id="paper-performance-forensics" class="item">'
      + '<h3 class="mini-title">Diagnóstico forense del rendimiento</h3>'
      + currentBanner
      + '<h3 class="mini-title" style="margin-top:12px">Motor actual · evidencia completa v1</h3>'
      + '<div class="grid">'
      + metric('Cierres actuales', current.rows.length)
      + metric('Muestra mínima', MIN_CURRENT_CLOSED_TRADES + ' cierres')
      + metric('Progreso de muestra', Math.min(current.rows.length, MIN_CURRENT_CLOSED_TRADES) + ' / ' + MIN_CURRENT_CLOSED_TRADES)
      + metric('Ganadas / perdidas actuales', current.wins.length + ' / ' + current.losses.length)
      + metric('Acierto actual', pct(current.winRate), current.winRate >= 0.5 ? 'positive' : 'negative')
      + metric('PnL actual', eur(current.net), cls(current.net))
      + metric('Expectativa actual', eur(current.expectancy), cls(current.expectancy))
      + metric('Profit factor actual', currentFactor, current.profitFactor >= MIN_CURRENT_PROFIT_FACTOR ? 'positive' : 'negative')
      + '</div>'
      + '<h3 class="mini-title" style="margin-top:12px">Histórico completo · contexto, no aprobación</h3>'
      + '<div class="grid">'
      + metric('Operaciones cerradas totales', report.rows.length)
      + metric('Ganadas / perdidas totales', report.wins.length + ' / ' + report.losses.length)
      + metric('Tasa de acierto total', pct(report.winRate), report.winRate >= 0.5 ? 'positive' : 'negative')
      + metric('PnL neto total', eur(report.net), cls(report.net))
      + metric('Expectativa total', eur(report.expectancy), cls(report.expectancy))
      + metric('Profit factor total', allFactor, report.profitFactor >= 1 ? 'positive' : 'negative')
      + metric('Ganancia media total', eur(report.avgWin), report.avgWin > 0 ? 'positive' : '')
      + metric('Pérdida media total', eur(report.avgLoss), report.avgLoss > 0 ? 'negative' : '')
      + metric('Evidencia completa nueva', report.complete.length)
      + metric('Históricas / legado', report.historical.length)
      + '</div>'
      + '<div class="section-stack" style="margin-top:12px"><div><h3 class="mini-title">Por carril · histórico completo</h3><div class="list">'
      + (laneRows || '<div class="empty">Sin cierres.</div>') + '</div></div>'
      + '<div><h3 class="mini-title">Por causa de salida · histórico completo</h3><div class="list">'
      + (reasonRows || '<div class="empty">Sin cierres.</div>') + '</div></div></div>'
      + '<div class="banner warn"><b>Interpretación:</b> las operaciones históricas se conservan íntegramente. La evaluación del motor actual requiere al menos ' + MIN_CURRENT_CLOSED_TRADES + ' cierres con evidencia completa v1; una o varias victorias aisladas nunca permiten aprobar LIVE.</div>'
      + '</article>';
  }

  const baseRenderSummaryForensics = typeof renderSummary === 'function' ? renderSummary : null;
  if (baseRenderSummaryForensics) {
    renderSummary = function renderSummaryWithForensics() {
      baseRenderSummaryForensics();
      const previous = document.getElementById('paper-performance-forensics-summary');
      if (previous) previous.remove();
      const report = performanceForensics();
      const current = report.current;
      const currentText = current.rows.length
        ? current.rows.length + ' cierres actuales · ' + current.wins.length + ' ganadas · ' + current.losses.length
          + ' perdidas · acierto ' + pct(current.winRate) + ' · expectativa ' + eur(current.expectancy)
        : 'sin cierres del motor actual con evidencia completa v1';
      const readinessText = report.sampleComplete
        ? (report.qualityPass ? 'muestra mínima completa, revisión todavía PAPER' : 'muestra completa pero negativa')
        : 'muestra insuficiente: ' + current.rows.length + ' / ' + MIN_CURRENT_CLOSED_TRADES;
      summary.insertAdjacentHTML('beforeend', '<div id="paper-performance-forensics-summary" class="banner '
        + (report.sampleComplete && !report.qualityPass ? 'bad' : 'warn') + '"><b>Calidad del motor actual:</b> ' + currentText
        + ' · ' + readinessText + '. Histórico conservado aparte: ' + report.historical.length + ' cierre(s) de legado.</div>');
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
