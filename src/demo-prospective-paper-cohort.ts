export const DEMO_PROSPECTIVE_PAPER_COHORT_CODE = String.raw`
(() => {
  const PROSPECTIVE_COHORT_STARTED_AT = Date.parse('2026-08-02T18:35:30Z');
  const PROSPECTIVE_COHORT_COMMIT = '2af2e0bb15d911f6cedcd91862ef77c8279ab2ed';
  const PROSPECTIVE_MIN_CLOSED_TRADES = 30;
  const PROSPECTIVE_MIN_PROFIT_FACTOR = 1.2;

  function prospectiveRows() {
    return (typeof pairs === 'function' ? pairs() : [])
      .filter(item => item && item.buy && item.sell)
      .filter(item => item.buy.evidenceVersion === 'paper-trade-evidence-v1'
        && item.sell.evidenceVersion === 'paper-trade-evidence-v1')
      .filter(item => n(item.sell.timestamp) >= PROSPECTIVE_COHORT_STARTED_AT)
      .map(item => ({
        pnl: n(item.sell.pnlEur),
        costs: n(item.sell.totalCostsEur),
        timestamp: n(item.sell.timestamp),
      }));
  }

  function prospectiveReport() {
    const rows = prospectiveRows();
    const wins = rows.filter(row => row.pnl > 0);
    const losses = rows.filter(row => row.pnl < 0);
    const netPnl = rows.reduce((sum, row) => sum + row.pnl, 0);
    const grossProfit = wins.reduce((sum, row) => sum + row.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.pnl, 0));
    const costs = rows.reduce((sum, row) => sum + row.costs, 0);
    const expectancy = rows.length ? netPnl / rows.length : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    let peak = 0;
    let equity = 0;
    let maximumDrawdown = 0;
    [...rows].sort((a, b) => a.timestamp - b.timestamp).forEach(row => {
      equity += row.pnl;
      peak = Math.max(peak, equity);
      maximumDrawdown = Math.max(maximumDrawdown, peak - equity);
    });
    const sampleComplete = rows.length >= PROSPECTIVE_MIN_CLOSED_TRADES;
    const qualityPass = sampleComplete && netPnl > 0 && expectancy > 0 && profitFactor >= PROSPECTIVE_MIN_PROFIT_FACTOR;
    return { rows, wins, losses, netPnl, costs, expectancy, profitFactor, maximumDrawdown, sampleComplete, qualityPass };
  }

  function prospectivePanel() {
    const report = prospectiveReport();
    const factor = Number.isFinite(report.profitFactor) ? report.profitFactor.toFixed(2) : '∞';
    const status = !report.sampleComplete
      ? 'Cohorte prospectiva en formación: ' + report.rows.length + ' / ' + PROSPECTIVE_MIN_CLOSED_TRADES + ' cierres.'
      : report.qualityPass
        ? 'Cohorte prospectiva supera los mínimos; LIVE continúa bloqueado.'
        : 'Cohorte prospectiva completa pero sin ventaja demostrada.';
    return '<article id="prospective-paper-cohort" class="item">'
      + '<h3 class="mini-title">Validación prospectiva inmutable</h3>'
      + '<div class="banner ' + (report.sampleComplete && !report.qualityPass ? 'bad' : 'warn') + '"><b>' + status + '</b> '
      + 'Corte fijo: ' + dt(PROSPECTIVE_COHORT_STARTED_AT) + ' · commit ' + PROSPECTIVE_COHORT_COMMIT.slice(0, 7)
      + '. No incluye operaciones anteriores ni histórico legado.</div>'
      + '<div class="grid">'
      + metric('Cierres prospectivos', report.rows.length)
      + metric('Progreso', Math.min(report.rows.length, PROSPECTIVE_MIN_CLOSED_TRADES) + ' / ' + PROSPECTIVE_MIN_CLOSED_TRADES)
      + metric('Ganadas / perdidas', report.wins.length + ' / ' + report.losses.length)
      + metric('PnL neto', eur(report.netPnl), cls(report.netPnl))
      + metric('Expectativa', eur(report.expectancy), cls(report.expectancy))
      + metric('Profit factor', factor, report.profitFactor >= PROSPECTIVE_MIN_PROFIT_FACTOR ? 'positive' : 'negative')
      + metric('Costes', eur(report.costs), report.costs > 0 ? 'negative' : '')
      + metric('Drawdown máximo', eur(report.maximumDrawdown), report.maximumDrawdown > 0 ? 'negative' : '')
      + '</div>'
      + '<div class="banner warn"><b>Criterio obligatorio:</b> al menos 30 cierres posteriores al corte, PnL neto positivo, expectativa positiva y profit factor ≥ 1,20. El historial no se resetea ni se modifica.</div>'
      + '</article>';
  }

  const baseRenderPerformanceProspective = typeof renderPerformance === 'function' ? renderPerformance : null;
  if (baseRenderPerformanceProspective) {
    renderPerformance = function renderPerformanceWithProspectiveCohort() {
      baseRenderPerformanceProspective();
      const previous = document.getElementById('prospective-paper-cohort');
      if (previous) previous.remove();
      performance.insertAdjacentHTML('afterbegin', prospectivePanel());
    };
  }
})();`;
