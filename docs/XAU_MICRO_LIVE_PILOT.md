# XAU/PAXG micro-LIVE pilot

This mode exists only to validate the real Kraken execution path with a maximum order notional of 5 EUR.

It does not replace the generic PAPER scale-up gate. Full-size or scaled LIVE capital remains blocked until the broader validation requirements are satisfied.

The micro-LIVE authority is XAU-specific and fails closed unless all of the following are true:

- at least 500 XAU decision cycles observed;
- at least 20 XAU decisions approved;
- at least 2 closed XAU PAPER positions;
- positive realized XAU PAPER PnL;
- XAU PAPER equity at or above initial capital;
- observed XAU drawdown no greater than 5%;
- no open XAU PAPER position;
- latest XAU decision no older than 3 minutes.

Execution remains separately guarded by Kraken authentication, safe permissions, account cleanliness, effective fees, PAXG/EUR metadata, maximum 5 EUR notional, one position only, FOK order semantics, write-ahead journal, reconciliation and mandatory native stop protection.
