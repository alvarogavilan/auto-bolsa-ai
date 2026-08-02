import { standaloneDemoDashboard } from "./demo-dashboard-standalone";
import { DEMO_FLATLINE_WATCHDOG_CODE, DEMO_FLATLINE_WATCHDOG_STYLE } from "./demo-flatline-watchdog";
import { DEMO_HISTORY_EVIDENCE_INTEGRITY_CODE } from "./demo-history-evidence-integrity";
import { DEMO_HISTORY_OUTCOMES_CODE, DEMO_HISTORY_OUTCOMES_STYLE } from "./demo-history-outcomes";
import { DEMO_LIVE_PRICES_SCRIPT } from "./demo-live-prices";
import { DEMO_OPERATION_DOSSIERS_CODE, DEMO_OPERATION_DOSSIERS_STYLE } from "./demo-operation-dossiers";
import { DEMO_PERFORMANCE_FORENSICS_CODE } from "./demo-performance-forensics";
import { DEMO_ZERO_POSITION_DIAGNOSTICS_CODE, DEMO_ZERO_POSITION_DIAGNOSTICS_STYLE } from "./demo-zero-position-diagnostics";

const DEMO_SINGLE_TREASURY_CODE = String.raw`
(() => {
  const treasury = () => lab && lab.treasuryDepartment && lab.treasuryDepartment.singleSourceOfTruth === true
    ? lab.treasuryDepartment
    : null;

  function positionAccounting() {
    const open = strategies.filter(strategy => strategy.position);
    const committed = open.reduce((sum, strategy) => sum + n(strategy.position && strategy.position.costEur), 0);
    const marketValue = open.reduce((sum, strategy) => sum + Math.max(0, n(strategy.equityEur) - n(strategy.cashEur)), 0);
    const realized = strategies.reduce((total, strategy) => total + (Array.isArray(strategy.trades) ? strategy.trades : [])
      .reduce((sum, trade) => sum + (trade.side === 'sell' && typeof trade.pnlEur === 'number' ? n(trade.pnlEur) : 0), 0), 0);
    const unrealized = marketValue - committed;
    const initial = n(treasury() && treasury().initialBankrollEur) || TARGET;
    const equity = Math.max(0, initial + realized + unrealized);
    return {
      initial,
      equity,
      cash: Math.max(0, equity - marketValue),
      invested: committed,
      marketValue,
      realized,
      unrealized,
      openPositions: open.length,
    };
  }

  const baseNorm = norm;
  norm = function treasuryNorm() {
    const fallback = baseNorm();
    const current = treasury();
    if (!current) return fallback;
    const accounting = positionAccounting();
    const treasuryCommitted = n(current.committedCapitalEur);
    const treasuryEquity = n(current.equityEur);
    const mismatch = Math.abs(treasuryCommitted - accounting.invested) > 0.01
      || Math.abs(treasuryEquity - accounting.equity) > 0.01;
    return {
      ...fallback,
      scale: 1,
      equity: accounting.equity,
      cash: accounting.cash,
      invested: accounting.invested,
      realized: accounting.realized,
      unrealized: accounting.unrealized,
      total: accounting.equity - accounting.initial,
      treasury: current,
      treasuryMismatchReconciled: mismatch,
      marketValue: accounting.marketValue,
    };
  };

  function sourceBanner() {
    const current = treasury();
    if (!current) return '<div class="banner warn"><b>Fuente contable:</b> Tesorería no disponible; se muestra el fallback técnico sin sumar carteras.</div>';
    const accounting = positionAccounting();
    const mismatch = Math.abs(n(current.committedCapitalEur) - accounting.invested) > 0.01
      || Math.abs(n(current.equityEur) - accounting.equity) > 0.01;
    return '<div class="banner' + (mismatch ? ' warn' : '') + '"><b>Fuente contable única:</b> '
      + esc(current.operationalModel || 'Tesorería PAPER única')
      + ' · esquema ' + esc(current.snapshotSchemaVersion || current.schemaVersion || 'no expuesto')
      + ' · banca inicial ' + eur(accounting.initial)
      + ' · capital comprometido reconciliado con ' + accounting.openPositions + ' posiciones: ' + eur(accounting.invested)
      + (mismatch ? ' · se corrigió una desincronización del snapshot usando las posiciones y trades persistidos.' : '')
      + ' · balances por estrategia solo comparativos.</div>';
  }

  const baseRenderSummary = renderSummary;
  renderSummary = function renderTreasurySummary() {
    baseRenderSummary();
    summary.insertAdjacentHTML('beforeend', sourceBanner());
  };

  const baseRenderPositions = renderPositions;
  renderPositions = function renderTreasuryPositions() {
    baseRenderPositions();
    const open = strategies.filter(strategy => strategy.position);
    const cards = positions.querySelectorAll('article.item');
    open.forEach((strategy, index) => {
      const nominal = n(strategy.position && strategy.position.costEur);
      if (nominal >= 5 || !cards[index]) return;
      cards[index].insertAdjacentHTML(
        'afterbegin',
        '<div class="banner warn"><b>Posición heredada:</b> nominal ' + eur(nominal)
          + ' inferior al mínimo vigente de 5 €. Se conserva por integridad histórica y no representa el sizing actual.</div>',
      );
    });
    positions.insertAdjacentHTML('beforeend', sourceBanner());
  };

  const baseRenderAudit = typeof renderAudit === 'function' ? renderAudit : null;
  if (baseRenderAudit) {
    renderAudit = function renderTreasuryAudit() {
      baseRenderAudit();
      audit.insertAdjacentHTML('afterbegin', sourceBanner());
    };
  }

  accountScale = function singleTreasuryLiveScale() {
    return 1;
  };

  updateSummary = function updateSingleTreasuryLiveSummary(liveRows, expectedOpenPositions) {
    if (!liveRows.length || liveRows.length !== expectedOpenPositions) return false;
    const metrics = [...document.querySelectorAll('#summary .metric')];
    const byLabel = (label) => metrics.find((node) => node.querySelector('span')?.textContent?.trim() === label)?.querySelector('strong');
    const currentStrategies = Array.isArray(latestLab?.state?.strategies) ? latestLab.state.strategies : [];
    const currentTreasury = latestLab?.treasuryDepartment?.singleSourceOfTruth === true ? latestLab.treasuryDepartment : null;
    const initial = num(currentTreasury?.initialBankrollEur) || 100;
    const realized = currentStrategies.reduce((total, strategy) => total + (Array.isArray(strategy.trades) ? strategy.trades : [])
      .reduce((sum, trade) => sum + (trade.side === 'sell' && typeof trade.pnlEur === 'number' ? num(trade.pnlEur) : 0), 0), 0);
    const liveValue = liveRows.reduce((sum, row) => sum + row.value, 0);
    const investedCost = liveRows.reduce((sum, row) => sum + row.cost, 0);
    const openPnl = liveRows.reduce((sum, row) => sum + row.openPnl, 0);
    const account = initial + realized + openPnl;
    const cash = Math.max(0, account - liveValue);
    const totalPnl = account - initial;
    const accountNode = byLabel('Valor de cuenta');
    const cashNode = byLabel('Saldo disponible');
    const investedNode = byLabel('Capital invertido');
    const totalNode = byLabel('PnL total');
    const openNode = byLabel('Posiciones abiertas');
    if (accountNode) {
      accountNode.textContent = eur(account);
      accountNode.className = totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : '';
    }
    if (cashNode) cashNode.textContent = eur(cash);
    if (investedNode) investedNode.textContent = eur(investedCost);
    if (openNode) openNode.textContent = String(expectedOpenPositions);
    if (totalNode) {
      totalNode.textContent = eur(totalPnl) + ' · ' + pct(initial > 0 ? totalPnl / initial : 0);
      totalNode.className = totalPnl > 0 ? 'positive' : totalPnl < 0 ? 'negative' : '';
    }
    return true;
  };
})();`;

export async function demoDashboard(): Promise<Response> {
  const response = standaloneDemoDashboard();
  const liveScript = DEMO_LIVE_PRICES_SCRIPT.replace(
    "})();\n</script>",
    `${DEMO_SINGLE_TREASURY_CODE}\n${DEMO_HISTORY_EVIDENCE_INTEGRITY_CODE}\n${DEMO_HISTORY_OUTCOMES_CODE}\n${DEMO_OPERATION_DOSSIERS_CODE}\n${DEMO_PERFORMANCE_FORENSICS_CODE}\n${DEMO_ZERO_POSITION_DIAGNOSTICS_CODE}\n${DEMO_FLATLINE_WATCHDOG_CODE}\n})();\n</script>`,
  );
  let html = await response.text();
  html = html
    .replace("</head>", `${DEMO_HISTORY_OUTCOMES_STYLE}${DEMO_OPERATION_DOSSIERS_STYLE}${DEMO_ZERO_POSITION_DIAGNOSTICS_STYLE}${DEMO_FLATLINE_WATCHDOG_STYLE}</head>`)
    .replace("const TARGET=50;", "const TARGET=100;")
    .replace("Cuenta equivalente de 50 €, separada del capital técnico multi-estrategia.", "Tesorería PAPER única de 100 €; no suma ficticia de carteras por estrategia. PnL histórico íntegro y balances por estrategia solo comparativos.")
    .replace("Cuenta equivalente de 50 €; no suma ficticia de nueve carteras.", "Tesorería PAPER única de 100 €; no suma ficticia de carteras por estrategia.")
    .replace("NO APTO PARA REAL", "NO APTO LIVE")
    .replace("Posiciones abiertas y cerradas", "Posiciones vigentes · Posiciones abiertas y cerradas")
    .replace("Mismo estado contable de Resumen, sin bloques heredados.", "Estado exacto del mismo capital mostrado en Resumen.")
    .replace("Cerradas · G/P", "Cerradas · G/P netas")
    .replace("JSON.stringify", "String")
    .replace("</body>", `${liveScript}</body>`);

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: response.status, headers });
}
