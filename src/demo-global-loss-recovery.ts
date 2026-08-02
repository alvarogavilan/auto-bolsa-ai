export const DEMO_GLOBAL_LOSS_RECOVERY_CODE = String.raw`
(() => {
  const GLOBAL_LOSS_RECOVERY_THRESHOLD = 3;

  function globalLossRecoveryStatus() {
    const currentStrategies = Array.isArray(strategies) ? strategies : [];
    const closes = currentStrategies
      .flatMap(strategy => Array.isArray(strategy.trades) ? strategy.trades : [])
      .filter(trade => trade && trade.side === 'sell' && typeof trade.pnlEur === 'number' && Number.isFinite(trade.pnlEur))
      .sort((left, right) => n(right.timestamp) - n(left.timestamp));
    let streak = 0;
    for (const trade of closes) {
      if (n(trade.pnlEur) >= 0) break;
      streak += 1;
    }
    const diagnostics = lab && lab.opportunityDiagnostics && lab.opportunityDiagnostics.globalLossRecovery
      ? lab.opportunityDiagnostics.globalLossRecovery
      : null;
    const ledger = lab && lab.opportunityAuditLedger ? lab.opportunityAuditLedger : null;
    const currentLosingStreak = diagnostics && typeof diagnostics.currentLosingStreak === 'number'
      ? diagnostics.currentLosingStreak
      : streak;
    const activationThreshold = diagnostics && typeof diagnostics.activationThreshold === 'number'
      ? diagnostics.activationThreshold
      : GLOBAL_LOSS_RECOVERY_THRESHOLD;
    const active = diagnostics && typeof diagnostics.active === 'boolean'
      ? diagnostics.active
      : currentLosingStreak >= activationThreshold;
    return {
      currentLosingStreak,
      activationThreshold,
      active,
      rejectedHistorical: ledger && typeof ledger.rejectedByLossRecovery === 'number' ? ledger.rejectedByLossRecovery : 0,
      rejectedByEarlyLossStreak: ledger && typeof ledger.rejectedByEarlyLossStreak === 'number' ? ledger.rejectedByEarlyLossStreak : 0,
      rejectedByNegativePattern: ledger && typeof ledger.rejectedByNegativePattern === 'number' ? ledger.rejectedByNegativePattern : 0,
      auditedCycles: ledger && typeof ledger.cyclesObserved === 'number' ? ledger.cyclesObserved : 0,
      ledgerSchema: ledger && ledger.schemaVersion ? String(ledger.schemaVersion) : 'no disponible',
      recoveryCondition: diagnostics && diagnostics.recoveryCondition
        ? String(diagnostics.recoveryCondition)
        : 'Solo ruptura o continuación confirmada con costes excepcionalmente bajos; un cierre no perdedor reinicia la racha.',
    };
  }

  function negativePatternText(status) {
    return 'Vetos tempranos por 3 pérdidas consecutivas: ' + status.rejectedByEarlyLossStreak
      + ' · vetos estadísticos por patrón negativo: ' + status.rejectedByNegativePattern
      + ' · ciclos auditados: ' + status.auditedCycles
      + ' · esquema ' + esc(status.ledgerSchema)
      + '. El freno temprano exige coincidencia exacta de carril, activo y motivo; el veto estadístico exige además al menos 5 cierres comparables, PnL negativo y profit factor inferior a 1.';
  }

  function globalLossRecoveryBanner() {
    const status = globalLossRecoveryStatus();
    const level = status.active ? 'bad' : status.currentLosingStreak > 0 ? 'warn' : 'safe';
    const headline = status.active ? 'Freno global PAPER activo: nuevas entradas ordinarias bloqueadas.' : 'Freno global PAPER inactivo.';
    return '<div id="global-loss-recovery-status" class="banner ' + level + '"><b>' + headline + '</b> '
      + 'Racha actual: ' + status.currentLosingStreak + ' / ' + status.activationThreshold
      + ' · vetos históricos por recuperación: ' + status.rejectedHistorical
      + ' · vetos tempranos de patrón: ' + status.rejectedByEarlyLossStreak
      + ' · vetos estadísticos de patrón: ' + status.rejectedByNegativePattern
      + ' · ' + esc(status.recoveryCondition)
      + ' Las salidas de seguridad y la gestión de posiciones abiertas continúan activas; LIVE permanece bloqueado.</div>';
  }

  const baseSummaryGlobalLossRecovery = typeof renderSummary === 'function' ? renderSummary : null;
  if (baseSummaryGlobalLossRecovery) {
    renderSummary = function renderSummaryWithGlobalLossRecovery() {
      baseSummaryGlobalLossRecovery();
      const previous = document.getElementById('global-loss-recovery-status');
      if (previous) previous.remove();
      summary.insertAdjacentHTML('afterbegin', globalLossRecoveryBanner());
    };
  }

  const baseAuditGlobalLossRecovery = typeof renderAudit === 'function' ? renderAudit : null;
  if (baseAuditGlobalLossRecovery) {
    renderAudit = function renderAuditWithGlobalLossRecovery() {
      baseAuditGlobalLossRecovery();
      const previous = audit.querySelector('#global-loss-recovery-status-audit');
      if (previous) previous.remove();
      const status = globalLossRecoveryStatus();
      audit.insertAdjacentHTML('afterbegin', '<div id="global-loss-recovery-status-audit" class="banner '
        + (status.active ? 'bad' : 'warn') + '"><b>Recuperación global PAPER:</b> racha '
        + status.currentLosingStreak + ' / ' + status.activationThreshold
        + ' · rechazadas específicamente por recuperación: ' + status.rejectedHistorical
        + ' · no se mezcla con exposición ni riesgo.</div>'
        + '<div id="negative-pattern-veto-audit" class="banner '
        + (status.rejectedByEarlyLossStreak > 0 || status.rejectedByNegativePattern > 0 ? 'warn' : 'safe') + '"><b>Filtros de patrones PAPER:</b> '
        + negativePatternText(status) + ' No alteran cierres, stops, posiciones abiertas ni el historial.</div>');
    };
  }
})();

(() => {
  const PROSPECTIVE_COHORT_STARTED_AT = Date.parse('2026-08-02T18:35:30Z');
  const PROSPECTIVE_COHORT_COMMIT = '2af2e0bb15d911f6cedcd91862ef77c8279ab2ed';
  const PROSPECTIVE_MIN_CLOSED_TRADES = 30;
  const PROSPECTIVE_MIN_PROFIT_FACTOR = 1.2;

  function prospectiveReport() {
    const rows = (typeof pairs === 'function' ? pairs() : [])
      .filter(item => item && item.buy && item.sell)
      .filter(item => item.buy.evidenceVersion === 'paper-trade-evidence-v1' && item.sell.evidenceVersion === 'paper-trade-evidence-v1')
      .filter(item => n(item.sell.timestamp) >= PROSPECTIVE_COHORT_STARTED_AT)
      .map(item => ({ pnl: n(item.sell.pnlEur), costs: n(item.sell.totalCostsEur), timestamp: n(item.sell.timestamp) }));
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
      : report.qualityPass ? 'Cohorte prospectiva supera los mínimos; LIVE continúa bloqueado.' : 'Cohorte prospectiva completa pero sin ventaja demostrada.';
    return '<article id="prospective-paper-cohort" class="item"><h3 class="mini-title">Validación prospectiva inmutable</h3>'
      + '<div class="banner ' + (report.sampleComplete && !report.qualityPass ? 'bad' : 'warn') + '"><b>' + status + '</b> Corte fijo: '
      + dt(PROSPECTIVE_COHORT_STARTED_AT) + ' · commit ' + PROSPECTIVE_COHORT_COMMIT.slice(0, 7) + '. No incluye operaciones anteriores ni histórico legado.</div>'
      + '<div class="grid">'
      + metric('Cierres prospectivos', report.rows.length)
      + metric('Progreso', Math.min(report.rows.length, PROSPECTIVE_MIN_CLOSED_TRADES) + ' / ' + PROSPECTIVE_MIN_CLOSED_TRADES)
      + metric('Ganadas / perdidas', report.wins.length + ' / ' + report.losses.length)
      + metric('PnL neto', eur(report.netPnl), cls(report.netPnl))
      + metric('Expectativa', eur(report.expectancy), cls(report.expectancy))
      + metric('Profit factor', factor, report.profitFactor >= PROSPECTIVE_MIN_PROFIT_FACTOR ? 'positive' : 'negative')
      + metric('Costes', eur(report.costs), report.costs > 0 ? 'negative' : '')
      + metric('Drawdown máximo', eur(report.maximumDrawdown), report.maximumDrawdown > 0 ? 'negative' : '')
      + '</div><div class="banner warn"><b>Criterio obligatorio:</b> al menos 30 cierres posteriores al corte, PnL neto positivo, expectativa positiva y profit factor ≥ 1,20. El historial no se resetea ni se modifica.</div></article>';
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