# Consola visual del piloto LIVE (solo lectura)

`src/pilot-dashboard.ts` exporta `pilotDashboard(): Response`, una pantalla
HTML mobile-first pensada para el iPhone que muestra el estado técnico de un
futuro piloto manual LIVE. Es una pantalla de **solo lectura**: no existe
ningún botón de envío, no se conecta a ninguna ruta del Worker en este PR, y
su único efecto de red es un `fetch('/api/pilot/readiness')` (GET) hecho por
el navegador del usuario cuando la página ya está cargada en su dispositivo.

## Qué es y qué no es

- No está enlazada a ninguna ruta: `src/index.ts` no se modifica en este PR.
  Integrar `pilotDashboard()` en una ruta real (y decidir su URL) queda para
  un PR posterior.
- No añade ningún binding, cron, variable de entorno ni `LIVE_TRADING_ENABLED`.
- No contiene ningún botón que pueda preparar, validar o enviar una orden:
  el único control interactivo es "Actualizar", que repite la misma lectura.
- No hace ninguna llamada a Kraken ni usa credenciales: todo el estado llega
  ya calculado y saneado desde `/api/pilot/readiness`.
- Nunca sugiere que el piloto garantiza beneficio; el texto es siempre
  informativo y condicional.

## Tolerancia a la forma exacta de `/api/pilot/readiness`

Esta pantalla se construyó antes de que el endpoint `/api/pilot/readiness`
devolviera todos los campos que necesita (certificado de preflight, journal
de envío, metadatos de mercado). Para no acoplarse a una forma exacta que
todavía puede cambiar, cada sección usa el helper `pick(source, paths)`, que
prueba varias rutas de campo plausibles (por ejemplo
`preflightCertificate.status` o `certificate.status`) y solo si ninguna
existe muestra **"No disponible"** en vez de fallar. Ninguna sección asume
que un campo concreto existe; el script nunca lanza una excepción por un
campo ausente.

Esto significa que, tal cual está hoy, la pantalla ya funciona contra el
`pilot-runtime-readiness-v1` real (PAPER, DEMO, conexión y permisos Kraken,
orden preparada, balance) y queda lista para mostrar certificado, journal,
metadatos de mercado y reconciliación detallada en cuanto una futura versión
del endpoint los incluya, sin necesidad de tocar esta pantalla otra vez.

## Secciones (mapeadas 1:1 con el alcance de la issue)

| Sección | Contenido | Origen esperado en el informe |
| --- | --- | --- |
| Estado general | Badge con uno de cuatro estados: bloqueado, preparando, elegible para revisión, ciclo anterior verificado | `blockers`, `eligibleForManualPilotReview` / `infrastructureEligibleForManualReview`, `previousPilotCycleVerified` |
| Bloqueadores / Avisos / Comprobaciones superadas | Listas ordenadas | `blockers`, `warnings`, `passedChecks` |
| Evidencia PAPER | Días, velas cerradas únicas, operaciones cerradas, PnL neto, profit factor, drawdown máximo, tasa de error, elegibilidad | `paper.*` (forma de `PaperReadiness`) |
| Conexión Kraken | Conectado/configurado, permisos auditados y seguros, saldo EUR | `kraken.connection.*`, `kraken.permissions.*` — nunca `apiKeyName`, huellas, secretos ni la lista completa de permisos |
| Mercado seleccionado | Par, mínimo de orden, precisión, spread, frescura | `market`/`pairMetadata` (pendiente en el endpoint actual; se muestra "No disponible" hasta entonces) |
| Orden preparada | Lado, par, tipo, volumen, precio, importe con el tope de 5 € | `executor.order` / `preparedOrder` |
| Certificado de preflight | Ausente / válido / caducado / consumido / inválido | `preflightCertificate.status` (pendiente en el endpoint actual) |
| Journal de envío | none / intent_persisted / transport_outcome_recorded / reconciled | `submissionJournal.phase` (pendiente en el endpoint actual) |
| Reconciliación | Estado del balance, si se ejecutó, resultado y órdenes sin resolver | `reconciliation.*` o, como alternativa ya disponible hoy, `executor.lastBalanceCheckStatus` |
| Emergencia y liquidación manual | Parada activa y liquidación manual pendiente | `emergency.*` o, como alternativa ya disponible hoy, `executor.emergencyStopActive` / `executor.emergencyStopRequiresManualLiquidation` |

Un aviso fijo en la cabecera y en el pie de página deja explícito en todo
momento que la pantalla nunca envía órdenes ni activa el trading real.

## Reglas de seguridad respetadas

- No se ha tocado `src/index.ts`, `src/live-executor-state.ts`,
  `src/live-executor.ts`, `src/live-transport.ts`,
  `src/live-certified-submission.ts`, `wrangler.jsonc`, `src/types.ts`, PAPER
  ni DEMO. Este PR solo añade `src/pilot-dashboard.ts`,
  `test/pilot-dashboard.test.ts` y este documento.
- No se añade ninguna ruta, binding, cron, variable de entorno ni botón de
  envío, y `LIVE_TRADING_ENABLED` no aparece en ningún sitio.
- No se muestran secretos, huellas, `ADMIN_TOKEN`, API key, API secret ni la
  lista detallada de permisos Kraken.
- No se usa ninguna palabra que sugiera que el piloto garantiza beneficio.

## Pruebas (`test/pilot-dashboard.test.ts`)

- La respuesta es HTML (`Content-Type: text/html`) con `Cache-Control: no-store`.
- Contiene exactamente una llamada `fetch('/api/pilot/readiness', …)` y ninguna otra.
- Contiene las doce secciones exigidas por la issue.
- Cubre cada métrica PAPER, cada campo de Kraken (sin datos sensibles), cada
  campo de mercado, cada campo de la orden preparada (incluido el tope de 5 €),
  los cinco estados de certificado, las cuatro fases de journal, la
  reconciliación y el estado de emergencia.
- Da representación visual explícita a los estados bloqueado, elegible y
  ciclo anterior verificado (y también a "preparando").
- Declara sin ambigüedad que la pantalla nunca envía órdenes ni activa el
  trading real, y nunca promete beneficio.
- No contiene `/api/live`, `createOrder`, `AddOrder`, `LIVE_TRADING_ENABLED`,
  `ADMIN_TOKEN` ni referencias a claves o secretos de API.
- No contiene ningún botón ni llamada capaz de preparar, validar o enviar
  una orden (`/api/pilot/submit`, `/api/pilot/prepare`, `/api/pilot/preflight`
  están ausentes).
