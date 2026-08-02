export const DEMO_ZERO_POSITION_DIAGNOSTICS_STYLE = `<style>
#zero-position-diagnostics{margin-top:14px}
#zero-position-diagnostics .funnel-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
#zero-position-diagnostics .reason-list{display:grid;gap:8px;margin-top:10px}
#zero-position-diagnostics .reason-row{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:#0d2947}
#zero-position-diagnostics .reason-row strong{font-size:14px}
@media(max-width:560px){#zero-position-diagnostics .funnel-grid{grid-template-columns:1fr}}
</style>`;

export const DEMO_ZERO_POSITION_DIAGNOSTICS_CODE = `
  const zeroPositionReasonLabel = (key) => ({
    'no-signal': 'Sin señal técnica válida',
    'no-new-candle': 'Sin nueva vela cerrada',
    'cooldown': 'En cooldown',
    'risk-or-execution-block': 'Bloqueo de riesgo, coste o ejecución',
    'error': 'Error técnico',
    'position-open': 'Ya existe posición abierta',
    'buy': 'Compra ejecutada',
    'sell': 'Cierre ejecutado',
    'other': 'Otro motivo',
  }[key] || key);

  const zeroPositionMetric = (label, value) => '<div class="metric"><span>' + label + '</span><strong>' + value + '</strong></div>';

  function renderZeroPositionDiagnostics() {
    const panel = document.getElementById('positions');
    if (!panel) return;
    let root = document.getElementById('zero-position-diagnostics');
    if (!root) {
      root = document.createElement('section');
      root.id = 'zero-position-diagnostics';
      panel.appendChild(root);
    }

    const report = lab.marketCoverageAudit || lab.coverageAudit || demo.marketCoverageAudit || null;
    const openCount = Array.isArray(strategies) ? strategies.filter((strategy) => strategy && strategy.position).length : 0;
    if (!report) {
      root.innerHTML = '<div class="banner warn"><b>Diagnóstico de actividad:</b> pendiente de informe de cobertura. No se asume que 0 posiciones sea correcto ni incorrecto sin evidencia.</div>';
      return;
    }

    const markets = report.markets || {};
    const roster = report.activeRoster || {};
    const activity = report.activity || {};
    const funnel = report.currentDecisionFunnel || {};
    const reasons = Object.entries(funnel)
      .map(([key, value]) => [key, Number(value || 0)])
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1]);
    const evaluated = reasons.reduce((sum, [, value]) => sum + value, 0);
    const activeStrategies = Number(roster.total || (Array.isArray(strategies) ? strategies.length : 0));
    const online = Number(markets.onlineEur || markets.online || 0);
    const compatible = Number(markets.capitalCompatible || markets.compatible || 0);
    const discovered = Number(markets.eurDiscovered || markets.discovered || 0);
    const stale = Number(activity.staleStrategies || 0);
    const errors = Number(activity.errorsLast12h || activity.errors || 0);
    const buys = Number(activity.buysLast12h || 0);
    const closes = Number(activity.closesLast12h || 0);
    const suspicious = openCount === 0 && (errors > 0 || stale > 0 || activeStrategies === 0 || evaluated === 0);
    const verdict = suspicious ? 'REVISAR BLOQUEO' : openCount === 0 ? 'PLANO EXPLICADO' : 'POSICIONES ACTIVAS';
    const verdictClass = suspicious ? 'bad' : openCount === 0 ? 'warn' : 'ok';

    root.innerHTML = '<div class="head"><div><h3 class="mini-title">Por qué hay ' + openCount + ' posiciones abiertas</h3><div class="sub">Embudo cuantitativo del mercado y de las decisiones PAPER. No relaja filtros ni cambia operaciones.</div></div><span class="status ' + verdictClass + '">' + verdict + '</span></div>' +
      '<div class="funnel-grid">' +
      zeroPositionMetric('Mercados EUR descubiertos', discovered || '—') +
      zeroPositionMetric('Mercados online', online || '—') +
      zeroPositionMetric('Compatibles con capital', compatible || '—') +
      zeroPositionMetric('Estrategias realmente activas', activeStrategies) +
      zeroPositionMetric('Decisiones clasificadas', evaluated) +
      zeroPositionMetric('Compras / cierres · 12 h', buys + ' / ' + closes) +
      '</div>' +
      (reasons.length ? '<div class="reason-list">' + reasons.map(([key, value]) => '<div class="reason-row"><span>' + zeroPositionReasonLabel(key) + '</span><strong>' + value + '</strong></div>').join('') + '</div>' : '<div class="empty">No hay decisiones clasificadas todavía; esto se considera un bloqueo observable, no una justificación automática.</div>') +
      '<div class="banner ' + verdictClass + '"><b>' + verdict + '.</b> ' + (report.diagnosis || (openCount === 0 ? 'El sistema está plano según los filtros actuales.' : 'Hay posiciones PAPER activas.')) + (stale ? ' · Estrategias sin actividad reciente: ' + stale + '.' : '') + (errors ? ' · Errores recientes: ' + errors + '.' : '') + '</div>';
  }

  const originalRenderPositionsOverview = typeof renderPositionsOverview === 'function' ? renderPositionsOverview : null;
  if (originalRenderPositionsOverview) {
    renderPositionsOverview = function () {
      originalRenderPositionsOverview();
      renderZeroPositionDiagnostics();
    };
  }
  window.addEventListener('load', () => setTimeout(renderZeroPositionDiagnostics, 700));
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.getAttribute('data-view') === 'positions' || target.id === 'refresh')) setTimeout(renderZeroPositionDiagnostics, 250);
  });
`;
