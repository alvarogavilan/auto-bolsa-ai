export const DEMO_HISTORY_OUTCOMES_STYLE = `<style>
#history .history-outcome{display:inline-flex;align-items:center;gap:6px;margin-top:7px;padding:6px 10px;border-radius:999px;font-size:12px;font-weight:900;letter-spacing:.02em}
#history .history-outcome.winner{background:rgba(76,221,162,.14);border:1px solid rgba(76,221,162,.45);color:var(--green)}
#history .history-outcome.loser{background:rgba(255,125,141,.14);border:1px solid rgba(255,125,141,.45);color:var(--red)}
#history .history-outcome.open{background:rgba(255,209,102,.13);border:1px solid rgba(255,209,102,.42);color:var(--amber)}
#history details.item.winner{border-color:rgba(76,221,162,.5)}
#history details.item.loser{border-color:rgba(255,125,141,.5)}
#history details.item.open{border-color:rgba(255,209,102,.35)}
</style>`;

export const DEMO_HISTORY_OUTCOMES_CODE = `
  const parseHistoryEuro = (text) => {
    const normalized = String(text || '').replace(/[^0-9,.-]/g, '').replace(/[.]/g, '').replace(',', '.');
    const value = Number(normalized);
    return Number.isFinite(value) ? value : null;
  };

  const historyDetailValue = (card, label) => {
    const rows = [...card.querySelectorAll('.kv')];
    const row = rows.find((node) => node.querySelector('span')?.textContent?.trim() === label);
    return row?.querySelector('strong')?.textContent?.trim() || '';
  };

  const setHistoryOutcome = (card, kind, label, valueText = '') => {
    const nextText = '● ' + label + (valueText ? ' · ' + valueText : '');
    const summaryText = card.querySelector('.order-head > div:nth-child(2)');
    if (!summaryText) return;
    let badge = summaryText.querySelector('.history-outcome');
    const alreadyCurrent = card.classList.contains(kind) && badge && badge.className === 'history-outcome ' + kind && badge.textContent === nextText;
    if (alreadyCurrent) return;
    card.classList.remove('winner', 'loser', 'open');
    card.classList.add(kind);
    if (!badge) {
      badge = document.createElement('span');
      summaryText.appendChild(badge);
    }
    badge.className = 'history-outcome ' + kind;
    badge.textContent = nextText;
  };

  function decorateHistoryOutcomes() {
    const panel = document.getElementById('history');
    if (!panel) return;
    const cards = [...panel.querySelectorAll('details.item')];
    if (!cards.length) return;

    const byId = new Map();
    cards.forEach((card) => {
      const id = historyDetailValue(card, 'ID').replace(' ⚠ DUPLICADO', '').trim();
      if (id) byId.set(id, card);
    });

    cards.forEach((card) => {
      const side = card.querySelector('.side')?.textContent || '';
      if (!side.includes('VENTA')) return;
      const pnlText = historyDetailValue(card, 'PnL realizado');
      const pnl = parseHistoryEuro(pnlText);
      if (pnl === null) return;
      const kind = pnl > 0 ? 'winner' : pnl < 0 ? 'loser' : 'open';
      const label = pnl > 0 ? 'GANADORA' : pnl < 0 ? 'PERDEDORA' : 'SIN RESULTADO';
      setHistoryOutcome(card, kind, label, pnlText);

      const buyId = historyDetailValue(card, 'Compra asociada');
      const buyCard = byId.get(buyId);
      if (buyCard) setHistoryOutcome(buyCard, kind, label, pnlText);
    });

    cards.forEach((card) => {
      if (card.querySelector('.history-outcome')) return;
      const side = card.querySelector('.side')?.textContent || '';
      if (side.includes('COMPRA')) setHistoryOutcome(card, 'open', 'ABIERTA');
    });
  }

  const startHistoryOutcomes = () => {
    decorateHistoryOutcomes();
    window.setInterval(decorateHistoryOutcomes, 2000);
  };
  window.addEventListener('load', () => setTimeout(startHistoryOutcomes, 250));
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (target instanceof HTMLElement && (target.getAttribute('data-view') === 'history' || target.id === 'refresh')) setTimeout(decorateHistoryOutcomes, 150);
  });
`;
