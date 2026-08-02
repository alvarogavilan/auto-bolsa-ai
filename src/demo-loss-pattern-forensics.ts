export const DEMO_LOSS_PATTERN_FORENSICS_CODE = String.raw`
(() => {
  const MIN_PATTERN_SAMPLE = 3;

  function classifyRegime(indicators) {
    if (!indicators || typeof indicators !== 'object') return 'Sin régimen';
    const fast = n(indicators.fastEma);
    const slow = n(indicators.slowEma);
    const rsi = n(indicators.rsi);
    if (fast > slow && rsi >= 50) return 'Alcista';
    if (fast < slow && rsi <= 50) return 'Bajista';
    return 'Lateral';
  }

  function normalizedReason(value, fallback) {
    const text = String(value || fallback || 'Sin motivo').trim();
    const lower = text.toLowerCase();
    if (lower.includes('stop')) return 'Stop loss';
    if (lower.includes('tiempo máximo')) return 'Tiempo máximo';
    if (lower.includes('rsi')) return 'RSI';
    if (lower.includes('cruce')) return lower.includes('alcista') ? 'Cruce alcista' : 'Cruce bajista';
    if (lower.includes('ruptura')) return 'Ruptura';
    if (lower.includes('continuación')) return 'Continuación';
    if (lower.includes('objetivo') || lower.includes('take profit')) return 'Objetivo';
    return text.slice(0, 48);
  }

  function summarizePattern(rows) {
    const wins = rows.filter(row => row.pnl > 0);
    const losses = rows.filter(row => row.pnl < 0);
    const net = rows.reduce((sum, row) => sum + row.pnl, 0);
    const grossProfit = wins.reduce((sum, row) => sum + row.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.pnl, 0));
    const costs = rows.reduce((sum, row) => sum + row.costs, 0);
    const expectancy = rows.length ? net / rows.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    const avgLoss = losses.length ? grossLoss / losses.length : 0;
    const avgDuration = rows.length ? rows.reduce((sum, row) => sum + row.duration, 0) / rows.length : 0;
    return {
      count: rows.length,
      wins: wins.length,
      losses: losses.length,
      net,
      costs,
      expectancy,
      profitFactor,
      avgLoss,
      avgDuration,
      statisticallyNegative: rows.length >= MIN_PATTERN_SAMPLE && expectancy < 0 && profitFactor < 1,
    };
  }

  function buildLossPatternRows() {
    const closed = typeof pairs === 'function' ? pairs().filter(item => item && item.sell) : [];
    return closed.map(item => {
      const buy = item.buy || {};
      const sell = item.sell || {};
      const evidenceComplete = buy.evidenceVersion === 'paper-trade-evidence-v1'
        && sell.evidenceVersion === 'paper-trade-evidence-v1';
      return {
        evidenceComplete,
        lane: item.s && item.s.lane ? item.s.lane : sell.lane || buy.lane || 'unknown',
        symbol: item.s && (item.s.symbol || item.s.id) ? (item.s.symbol || item.s.id) : '—',
        entryReason: normalizedReason(buy.reason, 'Entrada sin motivo'),
        exitReason: normalizedReason(sell.reason, 'Salida sin motivo'),
        regime: classifyRegime(buy.indicators),
        pnl: n(sell.pnlEur),
        costs: n(sell.totalCostsEur),
        duration: Math.max(0, n(sell.durationMinutes)),
      };
    }).filter(row => row.evidenceComplete);
  }

  function aggregateBy(rows, keyFn) {
    const groups = new Map();
    rows.forEach(row => {
      const key = keyFn(row);
      const current = groups.get(key) || [];
      current.push(row);
      groups.set(key, current);
    });
    return [...groups.entries()].map(([key, values]) => ({ key, ...summarizePattern(values) }))
      .sort((a, b) => Number(b.statisticallyNegative) - Number(a.statisticallyNegative)
        || a.expectancy - b.expectancy || b.count - a.count);
  }

  function patternForensics() {
    const rows = buildLossPatternRows();
    return {
      rows,
      byLane: aggregateBy(rows, row => lane(row.lane)),
      byAsset: aggregateBy(rows, row => row.symbol),
      byRegime: aggregateBy(rows, row => row.regime),
      byEntry: aggregateBy(rows, row => row.entryReason),
      byExit: aggregateBy(rows, row => row.exitReason),
      byCombined: aggregateBy(rows, row => lane(row.lane) + ' · ' + row.regime + ' · ' + row.entryReason + ' → ' + row.exitReason),
    };
  }

  function patternList(title, values) {
    const rows = values.slice(0, 8).map(value => {
      const factor = Number.isFinite(value.profitFactor) ? value.profitFactor.toFixed(2) : '∞';
      const status = value.statisticallyNegative
        ? '<span class="negative">Patrón negativo con muestra mínima</span>'
        : value.count < MIN_PATTERN_SAMPLE ? '<span class="muted">Muestra insuficiente</span>' : '<span class="muted">Sin veto estadístico</span>';
      return '<div class="item"><b>' + esc(value.key) + '</b><div class="sub">'
        + value.count + ' cierres · ' + value.wins + ' G / ' + value.losses + ' P · PnL ' + eur(value.net)
        + ' · expectativa ' + eur(value.expectancy) + ' · PF ' + factor
        + ' · costes ' + eur(value.costs) + ' · duración media ' + value.avgDuration.toFixed(0) + ' min<br>' + status
        + '</div></div>';
    }).join('');
    return '<div><h3 class="mini-title">' + esc(title) + '</h3><div class="list">'
      + (rows || '<div class="empty">Sin cierres actuales con evidencia completa.</div>') + '</div></div>';
  }

  function lossPatternPanel() {
    const report = patternForensics();
    const negatives = report.byCombined.filter(value => value.statisticallyNegative);
    return '<article id="paper-loss-pattern-forensics" class="item">'
      + '<h3 class="mini-title">Atribución de pérdidas del motor actual</h3>'
      + '<div class="banner ' + (negatives.length ? 'bad' : 'warn') + '"><b>'
      + (negatives.length
        ? negatives.length + ' patrón(es) con muestra mínima y expectativa negativa detectados.'
        : 'Todavía no hay patrones negativos con muestra mínima suficiente.')
      + '</b> El análisis usa únicamente cierres con evidencia completa v1. No altera operaciones, PnL ni parámetros.</div>'
      + '<div class="grid">'
      + metric('Cierres analizados', report.rows.length)
      + metric('Muestra mínima por patrón', MIN_PATTERN_SAMPLE)
      + metric('Patrones negativos', negatives.length, negatives.length ? 'negative' : '')
      + metric('Aprendizaje automático', 'Solo diagnóstico')
      + '</div>'
      + '<div class="section-stack" style="margin-top:12px">'
      + patternList('Por combinación completa', report.byCombined)
      + patternList('Por motivo de entrada', report.byEntry)
      + patternList('Por motivo de salida', report.byExit)
      + patternList('Por régimen técnico', report.byRegime)
      + patternList('Por carril', report.byLane)
      + patternList('Por activo', report.byAsset)
      + '</div>'
      + '<div class="banner warn"><b>Regla:</b> un patrón solo se marca como negativo con al menos '
      + MIN_PATTERN_SAMPLE + ' cierres, expectativa neta negativa y profit factor inferior a 1. Ningún filtro se relaja y LIVE continúa bloqueado.</div>'
      + '</article>';
  }

  const baseRenderPerformanceLossPatterns = typeof renderPerformance === 'function' ? renderPerformance : null;
  if (baseRenderPerformanceLossPatterns) {
    renderPerformance = function renderPerformanceWithLossPatterns() {
      baseRenderPerformanceLossPatterns();
      const previous = document.getElementById('paper-loss-pattern-forensics');
      if (previous) previous.remove();
      performance.insertAdjacentHTML('beforeend', lossPatternPanel());
    };
  }
})();`;
