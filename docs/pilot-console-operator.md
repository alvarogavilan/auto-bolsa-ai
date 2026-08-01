# Consola del piloto — flujo operativo seguro

La ruta `/pilot` es una consola administrativa para preparar y validar técnicamente una propuesta de hasta 5 EUR sin enviar una orden real.

## Sesión privada

- El `ADMIN_TOKEN` se guarda únicamente en `sessionStorage` de la pestaña actual.
- Al guardarlo, la consola actualiza automáticamente conexión, saldo y permisos de Kraken mediante `/api/pilot/refresh-kraken`.
- El token nunca se incluye en la URL, HTML, logs o informe de readiness.

## Fases visibles

1. **Actualizar comprobaciones seguras**: consulta conexión, saldo y permisos. No prepara ni envía órdenes.
2. **Preparar validación de hasta 5 EUR**: el servidor decide par, precio, volumen e importe; solo crea estado local validate-only.
3. **Validar en Kraken — no enviar**: usa `validate=true` con el mismo `clOrdId`; Kraken valida la forma de la orden sin crear una orden real.

Los bloqueos PAPER pueden impedir un piloto con dinero real, pero no bloquean esta validación técnica sin envío.

## Bloqueos permanentes

- `/api/pilot/submit` responde siempre `403 PILOT_SUBMISSION_NOT_ARMED`.
- `/api/live*` responde siempre `403 LIVE_TRADING_HARD_DISABLED`.
- El cron no invoca el ejecutor LIVE.
- No existe ningún botón de envío real en la consola.
