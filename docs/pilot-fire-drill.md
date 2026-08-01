# Simulacro integral del piloto manual

Este simulacro ejecuta seis escenarios completamente locales, efímeros y deterministas usando exclusivamente `FakeLiveOrderTransport`.

## Garantías

- No recibe `Env`.
- No recibe ni lee credenciales.
- No usa `fetch`.
- No contacta con Kraken.
- No accede al Durable Object de producción.
- No persiste estado.
- No crea órdenes reales.
- No modifica PAPER, DEMO ni decisiones de trading.

## Escenarios

1. Envío certificado y doble toque idempotente.
2. Timeout después de aceptación remota y recuperación por `clOrdId`.
3. Fill parcial y discrepancia de balance con parada de emergencia.
4. Certificado caducado antes del journal y transporte.
5. Payload alterado después del preflight.
6. Journal recreado con payload distinto y recuperación solo por reconciliación.

La ruta administrativa `POST /api/pilot/fire-drill` exige `ADMIN_TOKEN`. La tarjeta de `/pilot` solo ejecuta este simulacro local. La ruta pública de envío sigue bloqueada y el simulacro no forma parte del cron.
