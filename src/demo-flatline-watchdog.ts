export const DEMO_FLATLINE_WATCHDOG_STYLE = `<style>
#flatline-watchdog{margin-top:12px}
#flatline-watchdog .watchdog-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
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
    const timestamps = Array.isArray(strategies)
      ? strategies.flatMap((strategy) => [strategy.lastTradeAt, strategy.lastSuccessfulAt, strategy.lastAttemptAt]).map(Number).filter((value) => Number.isFinite(value) && value > 0)
      : [];
    const reference = timestamps.length ? Math.max(...timestamps) : Number((lab.state && lab.state.initializedAt) || lab.initializedAt || 0);
    const inactiveHours = reference > 0 ? Math.max(0, (now - reference) / 3600000) : null;
    const coverage = lab.marketCoverageAudit || lab.coverageAudit || demo.marketCoverageAudit || null;
    const activity = coverage && coverage.activity ? coverage.activity : {};
    const errors = Number(activity.errorsLast12h || activity.errors || 0);
    const stale = Number(activity.staleStrategies || 0);
    const decisions = coverage && coverage.currentDecisionFunnel
      ? Object.values(coverage.currentDecisionFunnel).reduce((sum, value) => sum + Number(value || 0), 0)
      : 0;
    const thresholdHours = 6;
    const breached = openCount === 0 && inactiveHours !== null && inactiveHours >= thresholdHours;
    const unexplained = breached && (errors > 0 || stale > 0 || decisions === 0);
    const status = openCount > 0 ? 'NORMAL' : unexplained ? 'ALERTA DE BLOQUEO' : breached ? 'PLANO PROLONGADO EXPLICADO' : 'VIGILANDO';
    const statusClass = unexplained ? 'bad' : breached ? 'warn' : 'ok';
    const hoursText = inactiveHours === null ? '—' : inactiveHours.toFixed(1) + ' h';

    root.innerHTML = '<div class="head"><div><h3 class="mini-title">Vigilancia de inactividad</h3><div class="sub">Detecta periodos prolongados sin posiciones ni actividad útil; no fuerza operaciones.</div></div><span class="status ' + statusClass + '">' + status + '</span></div>' +
      '<div class="watchdog-grid">' +
      '<div class="metric"><span>Tiempo sin actividad reciente</span><strong>' + hoursText + '</strong></div>' +
      '<div class="metric"><span>Umbral de revisión</span><strong>' + thresholdHours + ' h</strong></div>' +
      '<div class="metric"><span>Decisiones observadas</span><strong>' + decisions + '</strong></div>' +
      '</div>' +
      '<div class="banner ' + statusClass + '"><b>' + status + '.</b> ' +
      (openCount > 0
        ? 'Existen posiciones PAPER abiertas.'
        : unexplained
          ? 'La ausencia prolongada coincide con errores, estrategias estancadas o falta de decisiones clasificadas y requiere revisión técnica.'
          : breached
            ? 'No hay posiciones durante un periodo prolongado, pero el embudo de decisiones aporta una explicación observable.'
            : 'La ausencia actual todavía no supera el umbral de revisión.') +
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
