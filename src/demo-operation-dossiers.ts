export const DEMO_OPERATION_DOSSIERS_STYLE = `<style>
#operation-dossiers{margin-top:14px}
#operation-dossiers .dossier-summary{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px}
#operation-dossiers .dossier-card{border:1px solid var(--line);background:var(--card2);border-radius:16px;padding:13px}
#operation-dossiers .dossier-card.winner{border-color:rgba(76,221,162,.45)}
#operation-dossiers .dossier-card.loser{border-color:rgba(255,125,141,.45)}
#operation-dossiers .dossier-card.open{border-color:rgba(255,209,102,.4)}
#operation-dossiers .dossier-title{font-weight:900;margin-bottom:6px}
#operation-dossiers .dossier-meta{color:var(--muted);font-size:12px;line-height:1.45}
#operation-dossiers .coverage-warning{margin:10px 0;padding:11px;border-radius:13px;border:1px solid rgba(255,209,102,.4);background:rgba(255,209,102,.08);color:var(--amber);font-size:12px;line-height:1.45}
@media(max-width:560px){#operation-dossiers .dossier-summary{grid-template-columns:repeat(2,1fr)}}
</style>`;

export const DEMO_OPERATION_DOSSIERS_CODE = `
  const dossierMoney = (value) => Number(value || 0).toLocaleString('es-ES', { minimumFractionDigits: 4, maximumFractionDigits: 4 }) + ' €';
  const dossierDate = (value) => value ? new Date(value).toLocaleString('es-ES') : '—';
  const dossierCoverage = (operation) => {
    const entry = operation.entry || {};
    const exit = operation.exit;
    const required = [entry.reason, entry.price, entry.quantity, entry.feeEur, entry.stopLoss, entry.takeProfit, entry.timestamp];
    if (exit) required.push(exit.reason, exit.durationMinutes, exit.totalCostsEur, exit.netPnlEur);
    const complete = required.filter((value) => value !== null && value !== undefined && value !== '').length;
    return Math.round((complete / required.length) * 100);
  };
  const dossierCard = (operation) => {
    const exit = operation.exit;
    const kind = !exit ? 'open' : exit.netPnlEur > 0 ? 'winner' : exit.netPnlEur < 0 ? 'loser' : 'open';
    const label = !exit ? 'ABIERTA' : exit.netPnlEur > 0 ? (exit.economicallySignificant ? 'GANADORA SIGNIFICATIVA' : 'MICROGANANCIA') : exit.netPnlEur < 0 ? 'PERDEDORA' : 'NEUTRA';
    const coverage = dossierCoverage(operation);
    return '<details class="dossier-card ' + kind + '"><summary><div class="dossier-title">' + label + ' · ' + operation.symbol + ' · ' + operation.lane + '</div><div class="dossier-meta">Entrada ' + dossierDate(operation.entry.timestamp) + (exit ? ' · PnL neto ' + dossierMoney(exit.netPnlEur) : '') + ' · Cobertura ' + coverage + '%</div></summary><div class="kvs"><div class="kv"><span>Motivo de entrada</span><strong>' + operation.entry.reason + '</strong></div><div class="kv"><span>Precio / cantidad</span><strong>' + operation.entry.price + ' · ' + operation.entry.quantity + '</strong></div><div class="kv"><span>Comisión + deslizamiento entrada</span><strong>' + dossierMoney(operation.entry.feeEur + operation.entry.estimatedSlippageEur) + '</strong></div><div class="kv"><span>Stop / objetivo</span><strong>' + operation.entry.stopLoss + ' / ' + operation.entry.takeProfit + '</strong></div><div class="kv"><span>Indicadores de entrada</span><strong>' + (operation.entry.indicators ? JSON.stringify(operation.entry.indicators) : 'No persistidos en esta operación; pendiente para nuevas entradas') + '</strong></div>' + (exit ? '<div class="kv"><span>Motivo de salida</span><strong>' + exit.reason + '</strong></div><div class="kv"><span>Duración</span><strong>' + exit.durationMinutes + ' min</strong></div><div class="kv"><span>Costes totales</span><strong>' + dossierMoney(exit.totalCostsEur) + '</strong></div><div class="kv"><span>PnL neto</span><strong>' + dossierMoney(exit.netPnlEur) + '</strong></div>' : '') + '</div></details>';
  };
  async function renderOperationDossiers() {
    const auditPanel = document.getElementById('audit');
    if (!auditPanel) return;
    let root = document.getElementById('operation-dossiers');
    if (!root) {
      root = document.createElement('section');
      root.id = 'operation-dossiers';
      auditPanel.appendChild(root);
    }
    try {
      const response = await fetch('/api/lab', { cache: 'no-store' });
      const lab = await response.json();
      const report = lab.operationDossiers;
      if (!report || !Array.isArray(report.operations)) {
        root.innerHTML = '<div class="empty">Expedientes PAPER aún no disponibles.</div>';
        return;
      }
      const operationsWithIndicators = report.operations.filter((operation) => operation.entry && operation.entry.indicators).length;
      const indicatorCoveragePct = report.operations.length ? Math.round((operationsWithIndicators / report.operations.length) * 100) : 0;
      const warning = indicatorCoveragePct < 100 ? '<div class="coverage-warning">Cobertura de indicadores de entrada: ' + indicatorCoveragePct + ' %. No se inventan indicadores históricos. Las operaciones sin snapshot quedan marcadas como evidencia incompleta.</div>' : '';
      root.innerHTML = '<div class="head"><div><h2>Expedientes completos</h2><div class="muted">Fuente única: state.strategies[].trades · una compra y su venta forman una operación.</div></div></div><div class="dossier-summary"><div class="metric"><span>Cerradas</span><strong>' + report.closed + '</strong></div><div class="metric"><span>Abiertas</span><strong>' + report.open + '</strong></div><div class="metric"><span>Ganancias útiles</span><strong>' + report.significantWins + '</strong></div><div class="metric"><span>Indicadores persistidos</span><strong>' + indicatorCoveragePct + '%</strong></div></div>' + warning + '<div class="list">' + report.operations.map(dossierCard).join('') + '</div>';
    } catch {
      root.innerHTML = '<div class="empty">No se pudieron cargar los expedientes PAPER.</div>';
    }
  }
  window.addEventListener('load', () => setTimeout(renderOperationDossiers, 500));
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.getAttribute('data-view') === 'audit' || target.id === 'refresh')) setTimeout(renderOperationDossiers, 200);
  });
`;
