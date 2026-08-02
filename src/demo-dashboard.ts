import { standaloneDemoDashboard } from "./demo-dashboard-standalone";
import { DEMO_FLATLINE_WATCHDOG_CODE, DEMO_FLATLINE_WATCHDOG_STYLE } from "./demo-flatline-watchdog";
import { DEMO_HISTORY_OUTCOMES_CODE, DEMO_HISTORY_OUTCOMES_STYLE } from "./demo-history-outcomes";
import { DEMO_LIVE_PRICES_SCRIPT } from "./demo-live-prices";
import { DEMO_OPERATION_DOSSIERS_CODE, DEMO_OPERATION_DOSSIERS_STYLE } from "./demo-operation-dossiers";
import { DEMO_ZERO_POSITION_DIAGNOSTICS_CODE, DEMO_ZERO_POSITION_DIAGNOSTICS_STYLE } from "./demo-zero-position-diagnostics";

const DEMO_SINGLE_TREASURY_CODE = String.raw`
<script>
(() => {
  const treasury = () => lab && lab.treasuryDepartment && lab.treasuryDepartment.singleSourceOfTruth === true
    ? lab.treasuryDepartment
    : null;

  const baseNorm = norm;
  norm = function treasuryNorm() {
    const fallback = baseNorm();
    const current = treasury();
    if (!current) return fallback;
    const initial = n(current.initialBankrollEur) || TARGET;
    const equity = n(current.equityEur);
    return {
      ...fallback,
      scale: 1,
      equity,
      cash: n(current.freeCashEur),
      invested: n(current.committedCapitalEur),
      realized: n(current.realizedPnlEur),
      unrealized: n(current.unrealizedPnlEur),
      total: equity - initial,
      treasury: current,
    };
  };

  function sourceBanner() {
    const current = treasury();
    if (!current) return '<div class="banner warn"><b>Fuente contable:</b> Tesorería no disponible; se muestra el fallback técnico sin sumar carteras.</div>';
    return '<div class="banner"><b>Fuente contable única:</b> '
      + esc(current.operationalModel || 'Tesorería PAPER única')
      + ' · esquema ' + esc(current.snapshotSchemaVersion || current.schemaVersion || 'no expuesto')
      + ' · banca inicial ' + eur(current.initialBankrollEur)
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
})();
</script>`;

export async function demoDashboard(): Promise<Response> {
  const response = standaloneDemoDashboard();
  const liveScript = DEMO_LIVE_PRICES_SCRIPT.replace(
    "})();\n</script>",
    `${DEMO_HISTORY_OUTCOMES_CODE}\n${DEMO_OPERATION_DOSSIERS_CODE}\n${DEMO_ZERO_POSITION_DIAGNOSTICS_CODE}\n${DEMO_FLATLINE_WATCHDOG_CODE}\n})();\n</script>`,
  );
  let html = await response.text();
  html = html
    .replace("const TARGET=50;", "const TARGET=100;")
    .replace("Cuenta equivalente de 50 €, separada del capital técnico multi-estrategia.", "Tesorería PAPER única de 100 €, con PnL histórico íntegro y carteras por estrategia solo comparativas.")
    .replace("Cuenta equivalente de 50 €; no suma ficticia de nueve carteras.", "Tesorería PAPER única de 100 €; no suma ficticia de carteras por estrategia.")
    .replace("NO APTO PARA REAL", "NO APTO LIVE")
    .replace("Posiciones abiertas y cerradas", "Posiciones vigentes · Posiciones abiertas y cerradas")
    .replace("Mismo estado contable de Resumen, sin bloques heredados.", "Estado exacto de la Tesorería única mostrada en Resumen; las posiciones antiguas inferiores a 5 € se identifican como legado.")
    .replace("Cerradas · G/P", "Cerradas · G/P netas")
    .replace("JSON.stringify", "String")
    .replace("</body>", `${DEMO_SINGLE_TREASURY_CODE}${liveScript}</body>`);

  const headers = new Headers(response.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(html, { status: response.status, headers });
}
