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
      rejectedHistorical: ledger && typeof ledger.rejectedByLossRecovery === 'number'
        ? ledger.rejectedByLossRecovery
        : 0,
      recoveryCondition: diagnostics && diagnostics.recoveryCondition
        ? String(diagnostics.recoveryCondition)
        : 'Solo ruptura o continuación confirmada con costes excepcionalmente bajos; un cierre no perdedor reinicia la racha.',
    };
  }

  function globalLossRecoveryBanner() {
    const status = globalLossRecoveryStatus();
    const level = status.active ? 'bad' : status.currentLosingStreak > 0 ? 'warn' : 'safe';
    const headline = status.active
      ? 'Freno global PAPER activo: nuevas entradas ordinarias bloqueadas.'
      : 'Freno global PAPER inactivo.';
    return '<div id="global-loss-recovery-status" class="banner ' + level + '"><b>' + headline + '</b> '
      + 'Racha actual: ' + status.currentLosingStreak + ' / ' + status.activationThreshold
      + ' · vetos históricos por recuperación: ' + status.rejectedHistorical
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
        + ' · no se mezcla con exposición ni riesgo.</div>');
    };
  }
})();`;
