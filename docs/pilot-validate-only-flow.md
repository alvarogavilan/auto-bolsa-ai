# Flujo de validación previa al piloto (preparar + validate=true, sin envío)

Completa, dentro de la infraestructura del piloto ya desplegada (`docs/live-executor.md`,
issues #49/#50), el camino seguro previo a un futuro piloto real: construir en
servidor una propuesta de hasta 5 EUR con datos reales de Kraken, prepararla
localmente sin exigir `LIVE_TRADING_ENABLED`, validarla contra Kraken en modo
`validate=true`, y mostrar certificado/journal/reconciliación de forma
sanitizada. Ningún envío real es posible desde este flujo.

## Camino separado de preparación: `prepareValidationOrder()`

`prepareOrder()` (en `src/live-executor.ts`) exige `config.liveTradingEnabled
=== true`, porque esa comprobación vive dentro de `evaluateLiveGuardrails()` y
se aplica a través de la misma llamada compartida (`checkLiveGuardrails`).
`prepareValidationOrder()` es un camino **separado** que solo ignora ese
interruptor concreto —forzándolo a `true` exclusivamente dentro de la
evaluación de guardrails, nunca en `config` real— y comparte el resto de la
implementación con `prepareOrder()` a través de un helper interno común
(`prepareOrderInternal`). Esto garantiza que las demás puertas (par, mínimo,
precisión, máximo 5 €, datos frescos, pérdida diaria, drawdown, emergencia,
inventario, orden única) se evalúan de forma idéntica en ambos caminos, sin
riesgo de que diverjan con el tiempo.

`prepareValidationOrder()` no recibe transporte (su firma no tiene ese
parámetro) y deja un evento de auditoría distinto (`order_prepared_validation_only`)
frente a `order_prepared`. `submitOrder()` no se modifica: sigue exigiendo
`config.liveTradingEnabled === true` (el valor real) sin importar por qué
camino se preparó la orden.

## Calibración de baseline: `calibrateLiveBaseline()`

El `LiveExecutorState` histórico se inicializó con 50 € de ejemplo, pero un
piloto real puede partir de un saldo distinto (p. ej. ~10 €). Simular
`observeMarket(10)` sobre un baseline de 50 € registraría una caída del 80 %
falsa. `calibrateLiveBaseline()` fija `dayStartEquityEur`, `currentEquityEur`,
`peakEquityEur` y `lastMarketDataAt` al saldo EUR real consultado por el
servidor a Kraken, y **solo** se ejecuta si el estado sigue exactamente
prístino: sin orden activa, sin ninguna orden registrada (lo que también
implica que no existe journal pendiente, porque un journal solo se crea para
una orden ya preparada y certificada), sin inventario, sin emergencia ni
liquidación manual pendiente, y sin una reconciliación de balance previa.
Cualquier otro estado falla cerrado y dejan constancia auditada; la ruta
`/prepare-validation` la invoca de forma best-effort (si no está prístino,
simplemente se omite, sin bloquear la preparación).

## Propuesta construida en servidor: `src/pilot-validation.ts`

`computePilotValidationProposal()` es el núcleo puro y determinista (sin
`env`, sin `fetch`, sin caché): a partir del estado de Kraken ya auditado y
de los datos públicos de mercado ya obtenidos, calcula una propuesta de
compra límite de hasta `min(5 €, 50 % del saldo EUR real)`, con margen para
comisiones (0,4 %, el mismo taker fee usado en el resto del sistema PAPER),
precio ask cuantizado a `priceDecimals`, volumen truncado hacia abajo a
`lotDecimals`, comprobación de mínimo de Kraken, coherencia
`volume × price`, spread máximo (1 %, el límite más laxo que el propio
sistema PAPER ya acepta) e `idempotencyKey` nueva. `buildPilotValidationProposal(env)`
es el envoltorio async que resuelve `env.PAIR`, `krakenSafetySummary(env, true)`
y los datos públicos frescos, y delega todo el cálculo en la función pura.
Ninguna de las dos acepta par, volumen, precio, saldo ni importe del
navegador: la única entrada de la función async es `env`.

## Endpoint administrativo: `POST /api/pilot/prepare-validation`

Exige `ADMIN_TOKEN` como el resto de rutas `/api/pilot/*`. No lee ningún
campo económico del cuerpo de la petición: construye la propuesta en
servidor, calibra el baseline solo si es seguro, y llama a
`prepareValidationOrder()`. Devuelve la orden local sanitizada y su
`clOrdId`. `POST /api/pilot/preflight` (ya existente) sigue sin cambios:
usa siempre `validate=true` y reutiliza el mismo `clOrdId`, tanto para una
orden preparada por `prepareOrder()` como por `prepareValidationOrder()`.
`POST /api/pilot/submit` sigue devolviendo siempre `403
PILOT_SUBMISSION_NOT_ARMED` sin reenviarse nunca al Durable Object, y
`/api/live*` sigue en `403`.

## Informe de preparación ampliado

`GET /status` del `LiveExecutorState` ahora también incluye, sin secretos:
`certificateStatus` (`absent`/`valid`/`expired`/`consumed`/`invalid`, vía
`preflightCertificateDisplayStatus()`, que reutiliza la verificación exacta
`checkLivePreflightCertificate` en vez de adivinar por texto), `journal.phase`
(`none`/`intent_persisted`/`transport_outcome_recorded`/`reconciled`) y
`pairMetadata` (par, mínimo, decimales) para la orden relevante.
`buildPilotRuntimeReadiness()` (`src/pilot-runtime.ts`) expone estos tres
campos como `preflightCertificate`, `submissionJournal` y `market` en el
informe `pilot-runtime-readiness-v1`.

## App `/pilot`: dos acciones, ninguna de envío

`src/pilot-dashboard-access.ts` (la consola privada autenticada, no la
consola de solo lectura `src/pilot-dashboard.ts`, que permanece intacta)
añade exactamente dos botones:

1. **"Preparar validación de hasta 5 €"** → `POST /api/pilot/prepare-validation`,
   con confirmación explícita de que solo escribe estado local.
2. **"Validar en Kraken — no enviar"** → `POST /api/pilot/preflight`, visible
   únicamente tras recibir un `clOrdId` de la acción anterior, con
   confirmación explícita de que `validate=true` no envía la orden al motor
   de mercado.

Ninguno de los dos acepta un campo libre de par, volumen, precio, saldo o
importe. Ambas acciones refrescan `/api/pilot/readiness` al terminar. No se
añade ningún botón, texto clicable ni llamada relacionada con `/submit`.

## Reglas inmutables respetadas

- No se activó `LIVE_TRADING_ENABLED` en ningún momento (sigue ausente de
  `wrangler.jsonc`).
- No se añadió ningún binding, ruta de envío, cron ni migración nueva:
  `wrangler.jsonc` no se modificó.
- `POST /api/pilot/submit` sigue devolviendo siempre `403
  PILOT_SUBMISSION_NOT_ARMED` y nunca se reenvía al Durable Object.
- `/api/live*` sigue devolviendo `403 LIVE_TRADING_HARD_DISABLED`.
- El cron (`scheduled()`) no referencia el flujo de validación en ningún punto.
- No se modificó PAPER, DEMO, estrategias ni `src/pilot-dashboard.ts`.
- No se mostró ni se registró ningún secreto: el informe ampliado solo añade
  metadatos públicos del par y estados de certificado/journal, nunca claves,
  tokens ni huellas.
