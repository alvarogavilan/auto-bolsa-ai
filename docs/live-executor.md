# Ejecutor LIVE (encapsulado y permanentemente desactivado)

Infraestructura técnica para enviar órdenes spot reales a Kraken, construida en
paralelo a la estrategia PAPER y sin ningún camino que la active hoy.

## Qué existe

- `src/kraken.ts`: `addOrder`, `queryOrders`, `openOrders`, `closedOrders`,
  `cancelOrder`. Reutilizan la firma HMAC-SHA512 y el manejo de `nonce` ya
  validados por `kraken-auth.test.ts`. `KrakenApiError`/`isKrakenOrderRejection`
  distinguen un rechazo explícito de Kraken (`EOrder:*`) de cualquier otro
  fallo (HTTP, red, `EAPI:*`, `EGeneral:*`).
- `src/kraken-nonce.ts`: `computeNextNonce`, el cálculo puro del nonce. Existe
  una única autoridad persistente por clave de API (`BotState`, ver
  `docs/kraken-api-safety.md`); el ejecutor LIVE le pide el nonce a esa misma
  autoridad en vez de mantener su propio contador.
- `src/live-transport.ts`: interfaz `LiveOrderTransport` (incluye
  `findByClOrdId` y `fetchBalances`) + `KrakenLiveOrderTransport` (real) +
  `FakeLiveOrderTransport` (mock por defecto, sin red, usado en todas las
  pruebas).
- `src/live-guardrails.ts`: puertas de riesgo puras — interruptor
  `LIVE_TRADING_ENABLED`, una sola orden activa, una sola posición abierta
  (inventario real, no un booleano), tamaño máximo (5 EUR por defecto),
  validación estricta de la intención (números finitos/positivos, par
  permitido, `volumeBase × limitPrice` coherente con `notionalEur`, mínimo y
  precisión reales de Kraken vía `pairMetadata`: `orderMinBase`,
  `lotDecimals`, `priceDecimals`), liquidación manual pendiente, pérdida
  diaria, drawdown, datos de mercado obsoletos y errores de transporte
  consecutivos.
- `src/live-executor.ts`: máquina de estados (`prepared → submitted →
  partially_filled/filled/cancelled/rejected/reconciliation_required`),
  `cl_ord_id` único (UUID estándar) con idempotencia persistente y estricta
  (una `idempotencyKey` reutilizada con una solicitud distinta se bloquea, no
  se reutiliza en silencio), inventario real (`pair`, `quantityBase`,
  `averageCostEur`, `reservedQuantityBase`) actualizado por cada fill
  incremental —no solo al cerrar la orden— y cuantizado según `lot_decimals`
  del par (no redondeado a 6 decimales como el dinero), reconciliación contra
  órdenes abiertas/cerradas remotas y contra el balance real (un fallo o una
  clave de activo ausente cuenta como estado desconocido y bloquea, nunca
  como consistente), reintento que nunca reenvía a ciegas (`findByClOrdId`
  primero; si no hay evidencia, se mantiene `reconciliation_required` y se
  exige revisión humana, jamás un reenvío automático), cancelación de
  emergencia con cierre conservador, y un registro auditable de cada
  transición.
- `src/live-executor-state.ts`: Durable Object que persistiría el snapshot en
  `ctx.storage` para sobrevivir a un reinicio del proceso. **No está enlazado
  en `wrangler.jsonc` ni exportado desde `index.ts`: Cloudflare no lo
  despliega, no existe como recurso real en la cuenta.** La recuperación tras
  reinicio se valida en los tests serializando/deserializando el snapshot
  (el mismo objeto plano que este Durable Object guardaría), sin necesidad de
  desplegar nada para demostrarlo.

## Por qué es seguro desplegarlo

- `LIVE_TRADING_ENABLED` no aparece en `wrangler.jsonc`. La variable llega
  como `undefined` a `Env`, y `liveTradingEnabledFromEnv` solo devuelve
  `true` para el literal `"true"`. `evaluateLiveGuardrails` comprueba este
  interruptor primero y de forma independiente del resto de puertas, y
  `submitOrder` lo vuelve a comprobar (junto con todas las demás puertas)
  justo antes de enviar, no solo al preparar.
- `LiveExecutorState` NO se exporta desde `src/index.ts` ni tiene binding en
  `wrangler.jsonc`: Cloudflare nunca lo instancia. No es que "nada lo llame en
  producción" — directamente no existe en producción como Durable Object. Es
  el diseño más conservador posible: la infraestructura técnica existe como
  código probado, sin crear ningún recurso nuevo en la cuenta de Cloudflare.
- Las rutas `/api/live*` siguen devolviendo `403 LIVE_TRADING_HARD_DISABLED`
  exactamente igual que antes de este cambio; ese bloque de código no se ha
  tocado.
- `KrakenLiveOrderTransport` solo se instancia si `LIVE_TRADING_ENABLED ===
  "true"` **y** existen `KRAKEN_API_KEY`/`KRAKEN_API_SECRET`; en cualquier
  otro caso `LiveExecutorState` construye `FakeLiveOrderTransport`, que nunca
  hace una petición de red.
- Ni la estrategia PAPER (`bot-state.ts`, `research-lab.ts`) ni sus rutas se
  han modificado. Los cambios en `bot-state.ts` son exponer
  `POST /kraken/next-nonce` (única autoridad de nonce) y mover la auditoría
  de permisos (`GET /kraken/permissions`) desde `index.ts`, que antes
  calculaba su propio nonce ad-hoc; `test/kraken-single-authority.test.ts`
  comprueba de forma arquitectónica (escaneando el código fuente) que ningún
  otro fichero construye un nonce ni importa una función privada de Kraken.

## Modelo de amenazas e invariantes

| Amenaza | Invariante que la mitiga |
| --- | --- |
| Activación accidental por variable de entorno mal puesta | `liveTradingEnabledFromEnv` exige el literal exacto `"true"`; ausente o cualquier otro valor es `false`. Se comprueba tanto en `prepare` como, de nuevo, justo antes de `submit`. |
| Doble envío de la misma orden (reintento de red, doble clic) | `cl_ord_id` único (UUID estándar) derivado de un `idempotencyKey` persistido en `idempotencyIndex`; `prepareOrder` devuelve la orden existente en vez de crear una nueva. El transporte también deduplica por `cl_ord_id`. |
| Reenviar a ciegas una orden ambigua tras un timeout | Si `exchangeOrderId` es `null`, `retryReconciliation` primero llama a `findByClOrdId`. Si no la encuentra, eso NO se toma como prueba de que Kraken no la recibió: la orden permanece en `reconciliation_required` y, agotados los intentos de localización, se activa `emergencyStopActive` exigiendo revisión humana. `retryReconciliation` nunca llama a `submitOrder`, y `submitOrder` en sí mismo rechaza cualquier orden en `reconciliation_required` (audita el intento y jamás llama a `transport.createOrder()`) incluso si un futuro llamador la invoca directamente, saltándose `retryReconciliation`: solo envía órdenes en `prepared`. |
| Dos contadores de nonce independientes desordenando la clave | Autoridad única (`BotState.nextKrakenNonce`, endpoint `POST /kraken/next-nonce`); `LiveExecutorState` nunca mantiene su propio contador. `computeNextNonce` está probado por separado. |
| Confundir un fallo de transporte con un rechazo real | Solo un código `EOrder:*` explícito de Kraken es un rechazo terminal (`isKrakenOrderRejection`); timeout, red, HTTP 5xx, `EAPI:*`/`EGeneral:*` o respuesta ambigua siempre van a `reconciliation_required`. |
| Abrir dos posiciones o dos órdenes a la vez | `activeClOrdId` bloquea cualquier orden nueva mientras haya una activa; el inventario real (`quantityBase > 0`) bloquea abrir una segunda posición. |
| Vender un activo o una cantidad que no se tiene | El inventario exige que el par de la venta coincida con el de la posición y que el volumen no supere lo realmente disponible (`quantityBase - reservedQuantityBase`). |
| Orden de tamaño excesivo, mal formada, o por debajo del mínimo/precisión real de Kraken | `maxOrderNotionalEur` (5 EUR por defecto) y `validateOrderIntent` (números finitos/positivos, par permitido, `volumeBase × limitPrice` coherente con `notionalEur`, `orderMinBase`/`lotDecimals`/`priceDecimals` reales del par) se validan antes de generar el `cl_ord_id`. |
| Reutilizar una `idempotencyKey` con una solicitud distinta (par, lado, volumen o precio) | `prepareOrder` compara la solicitud nueva contra la original; solo un reintento exactamente idéntico se deduplica, cualquier diferencia se bloquea y se audita (`idempotency_key_collision_blocked`). |
| Reventar el límite de pérdida diaria o drawdown, incluso entre `prepare` y `submit` | Guardrails de `dayStartEquityEur`/`peakEquityEur` idénticos en espíritu a los de `bot-state.ts`, re-evaluados justo antes de enviar. |
| Actuar sobre datos de mercado obsoletos, incluso si caducan después de `prepare` | `lastMarketDataAt` con `maxMarketDataAgeMs` (5 minutos por defecto); se re-evalúa en `submit`, no solo en `prepare`. |
| Fallos en cascada del transporte | `consecutiveTransportErrors` con disyuntor configurable; además cada intento de envío está acotado por `MAX_SUBMISSION_ATTEMPTS`. |
| Estado ambiguo tras timeout o respuesta ininteligible | Nunca se asume éxito ni fracaso: se transiciona a `reconciliation_required` y solo `reconcile()`/`retryReconciliation()` resuelven la verdad contra el exchange. |
| Perder inventario real en la contabilidad tras un fill parcial cancelado | El inventario se actualiza por cada delta de ejecución (`applyFillDelta`), no solo cuando la orden llega a `filled`; una orden `cancelled` tras un fill parcial deja la cantidad realmente ejecutada, ni más ni menos. |
| Inventario local desincronizado del balance real, o tratarlo como consistente "por defecto" | `reconcile()` contrasta `inventory.quantityBase` contra `fetchBalances()` (tolerando los prefijos `X`/`XX` de Kraken). Tanto un fallo al obtener el balance como la ausencia de la clave de activo esperada cuentan como estado `"unknown"`, nunca `"consistent"`; cualquier estado que no sea consistente activa `emergencyStopActive` de inmediato, exista o no una orden activa, y fuerza `reconciliation_required` en toda orden no terminal. |
| Redondear una cantidad de BTC como si fuera dinero (6 decimales) y perder precisión real | El inventario se cuantiza según `lot_decimals` del par (`quantizeToDecimals`), no con el redondeo a 6 decimales usado para importes en EUR. |
| Creer que "cancelación de emergencia" también liquida una posición ya ejecutada | `emergencyCancelAll` solo cancela órdenes; si queda inventario, activa `emergencyStopRequiresManualLiquidation` en vez de vender nada automáticamente. |
| Emergencia con órdenes en curso | `emergencyCancelAll` cancela toda orden no terminal (o la cierra localmente si nunca llegó a enviarse) y activa `emergencyStopActive`, que bloquea cualquier nueva orden hasta que se despeje explícitamente. |
| Despejar la parada de emergencia sin haber resuelto realmente el inventario o el balance pendiente | `clearEmergencyStop` apaga la alarma (`emergencyStopActive`), pero NO borra `emergencyStopRequiresManualLiquidation` mientras siga existiendo (a) una orden en `reconciliation_required`, o (b) inventario real sin que el último `lastBalanceCheckStatus` sea `"consistent"`. Ese flag bloquea cualquier orden nueva (`manualLiquidationPending`), abrir o cerrar. Una discrepancia de balance invalida cualquier `"consistent"` previo (`lastBalanceCheckStatus = null`); solo una `reconcile()` posterior que vuelva a confirmarlo permite, tras un segundo `clearEmergencyStop`, volver a operar. |
| Pérdida de estado por reinicio del proceso | El snapshot es un objeto plano serializable, del tipo que `LiveExecutorState` persistiría en `ctx.storage`; `test/live-executor.test.ts` verifica que un ciclo `JSON.stringify`/`JSON.parse` conserva órdenes, inventario, idempotencia y auditoría. |
| Crear un recurso real en Cloudflare para una infraestructura que debe seguir desactivada | `LiveExecutorState` no tiene binding ni migración en `wrangler.jsonc` y no se exporta desde `index.ts`: Cloudflare no lo despliega. |

## Typecheck de producción aislado del de pruebas

`test/kraken-single-authority.test.ts` necesita `fs`/`path` de Node para leer
`src/*.ts` como texto. En vez de añadir los tipos de Node al `tsconfig.json`
de producción (lo que ocultaría, en el propio typecheck, el uso accidental de
una API de Node inexistente en Cloudflare Workers), hay dos programas
separados:

- `tsconfig.json` (`npm run typecheck:worker`): solo `src/**/*.ts`, solo
  `@cloudflare/workers-types`. Es la comprobación que certifica que el código
  del Worker no depende de nada que no exista en el runtime real.
- `tsconfig.test.json` (`npm run typecheck:test`): extiende el anterior,
  añade `"node"` a `types` e incluye también `test/**/*.ts`.

`npm run typecheck` ejecuta ambos; `.github/workflows/ci.yml` los llama como
pasos separados (`typecheck:worker` y `typecheck:test`) antes de `npm test`.

## Limitación reconocida

La reconciliación contrasta órdenes (abiertas/cerradas) y balances, pero no
baja al nivel de operaciones/fills individuales (`TradesHistory` de Kraken).
Para el alcance de esta infraestructura desactivada —que nunca envía nada a
producción— se considera suficiente; profundizar en reconciliación por
operación individual queda como trabajo explícito antes de un piloto manual
(ver más abajo).

## Lo que falta explícitamente para un piloto manual

Ninguno de estos pasos se ha dado en este PR:

1. Añadir el binding y la migración de `LiveExecutorState` en
   `wrangler.jsonc`, exportarlo desde `index.ts`, y solo entonces añadir una
   ruta HTTP autenticada (o un flujo separado) que invoque `env.LIVE_EXECUTOR`;
   hoy no existe ninguna de las tres cosas.
2. Poner `LIVE_TRADING_ENABLED=true` como secreto/variable de Cloudflare de
   forma explícita y separada de cualquier despliegue automático.
3. Conceder a la API key de Kraken los permisos mínimos de trading (sin
   retirada) y verificarlos con el auditor de permisos ya existente.
4. Definir y probar en producción el procedimiento manual de cancelación de
   emergencia (quién lo acciona, con qué credencial, en qué plazo) y la ruta
   real de liquidación manual cuando `emergencyStopRequiresManualLiquidation`
   quede activo.
5. Ejecutar la reconciliación (`reconcile`) en un cron real y decidir la
   cadencia y las alertas ante `reconciliation_required` prolongado.
6. Profundizar la reconciliación a nivel de operación/fill individual
   (`TradesHistory`), no solo estado de orden y balance agregado.
7. Fijar el tamaño máximo real de piloto (el código usa 5 EUR) y el criterio
   explícito de las puertas del README ("Puertas obligatorias antes de
   operar con dinero real").
8. Revisión humana explícita y registrada del primer ciclo real antes de
   dejarlo desatendido.
9. Sincronizar `DEFAULT_PAIR_METADATA` (`orderMinBase`, `lotDecimals`,
   `priceDecimals`) contra el endpoint público `AssetPairs` de Kraken; los
   valores actuales son de ejemplo, no verificados en vivo.
10. Diseñar una ruta de liquidación manual real y reconciliada para cuando
    `emergencyStopRequiresManualLiquidation` quede activo: hoy el sistema
    bloquea correctamente cualquier orden nueva mientras eso ocurre, pero no
    ofrece ningún camino (ni manual ni automático) para resolverlo dentro del
    propio ejecutor.
