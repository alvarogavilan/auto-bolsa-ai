# Integridad de Historial y Evidencia en DEMO

La DEMO reconstruye el Historial directamente desde `state.strategies[].trades`. Si el render principal no representa todos los movimientos retenidos, activa una vista de recuperación explícita en lugar de mostrar una pestaña vacía.

Cuando `paperEvidenceLedger` todavía no está disponible, Evidencia usa un fallback visible desde los mismos trades persistidos y muestra compras, ventas, cierres y PnL neto retenido.

Estas capas son únicamente observacionales. No cambian parámetros, filtros, posiciones, PAPER, LIVE ni la ejecución de órdenes reales.
