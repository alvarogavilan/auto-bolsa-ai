export const DEMO_NEGATIVE_PATTERN_AUDIT_CODE = String.raw`
(() => {
  function negativePatternLedger() {
    const candidates = [
      lab && lab.paperOpportunityAuditLedger,
      lab && lab.opportunityAuditLedger,
      lab && lab.auditLedger,
      demo && demo.paperOpportunityAuditLedger,
      demo && demo.opportunityAuditLedger,
    ];
    return candidates.find(value => value && typeof value === 'object') || null;
  }

  function negativePatternBanner() {
    const ledger = negativePatternLedger();
    const count = ledger ? n(ledger.rejectedByNegativePattern) : 0;
    const cycles = ledger ? n(ledger.cyclesObserved) : 0;
    const schema = ledger && ledger.schemaVersion ? esc(ledger.schemaVersion) : 'no disponible';
    return '<div class="banner ' + (count > 0 ? 'warn' : '') + '"><b>Vetos por patrón negativo:</b> '
      + count
      + ' · ciclos auditados: ' + cycles
      + ' · esquema ' + schema
      + '. Solo se contabilizan entradas PAPER bloqueadas por coincidencia exacta de carril, activo y motivo con muestra suficiente, PnL negativo y profit factor inferior a 1.</div>';
  }

  const baseRenderAudit = typeof renderAudit === 'function' ? renderAudit : null;
  if (baseRenderAudit) {
    renderAudit = function renderNegativePatternAudit() {
      baseRenderAudit();
      audit.insertAdjacentHTML('beforeend', negativePatternBanner());
    };
  }

  const baseRenderSummary = typeof renderSummary === 'function' ? renderSummary : null;
  if (baseRenderSummary) {
    renderSummary = function renderNegativePatternSummary() {
      baseRenderSummary();
      const ledger = negativePatternLedger();
      const count = ledger ? n(ledger.rejectedByNegativePattern) : 0;
      if (count > 0) summary.insertAdjacentHTML('beforeend', negativePatternBanner());
    };
  }
})();`;
