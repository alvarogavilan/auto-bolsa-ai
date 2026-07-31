# Ejecutor LIVE (encapsulado y permanentemente desactivado)

Infraestructura técnica para enviar órdenes spot reales a Kraken, construida en
paralelo a la estrategia PAPER y sin ningún camino que la active hoy.

## Qué existe

- `src/kraken.ts`: `addOrder`, `queryOrders`, `openOrders`, `closedOrders`,
  `cancelOrder`. Reutilizan la firma HMAC-SHA512 y el manejo de `nonce` ya
  validados por `kraken-auth.test.ts`.
- `src/live-transport.ts`: interfaz `LiveOrderTransport` +
  `KrakenLiveOrderTransport` (real) + `FakeLiveOrderTransport` (mock por
  defecto, sin red, usado en todas las pruebas).
- `src/live-guardrails.ts`: puertas de riesgo puras — interruptor
  `LIVE_TRADING_ENABLED`, una sola orden activa, una sola posición abierta,
  tamaño máximo (5 EUR por defecto), pérdida diaria, drawdown, datos de
  mercado obsoletos y errores de transporte consecutivos.
- `src/live-executor.ts`: máquina de estados (`prepared → submitted →
  partially_filled/filled/cancelled/rejected/reconciliation_required`),
  `cl_ord_id` único con idempotencia persistente en el snapshot,
  reconciliación contra órdenes abiertas/cerradas remotas, reintento acotado,
  cancelación de emergencia con cierre conservador y un registro auditable de
  cada transición.
- `src/live-executor-state.ts`: Durable Object que persiste el snapshot
  anterior en `ctx.storage`, para que la idempotencia y la reconciliación
  sobrevivan a un reinicio del proceso.

## Por qué es seguro desplegarlo

- `LIVE_TRADING_ENABLED` no aparece en `wrangler.jsonc`. La variable llega
  como `undefined` a `Env`, y `liveTradingEnabledFromEnv` solo devuelve
  `true` para el literal `"true"`. `evaluateLiveGuardrails` comprueba este
  interruptor primero y de forma independiente del resto de puertas.
- `LiveExecutorState` se exporta desde `src/index.ts` únicamente para que
  Cloudflare pueda instanciar el Durable Object declarado en
  `wrangler.jsonc`. **Ninguna ruta HTTP ni el `scheduled()` del Worker
  invocan `env.LIVE_EXECUTOR`.** El objeto persiste, pero nada lo llama en
  producción.
- Las rutas `/api/live*` siguen devolviendo `403 LIVE_TRADING_HARD_DISABLED`
  exactamente igual que antes de este cambio; ese bloque de código no se ha
  tocado.
- `KrakenLiveOrderTransport` solo se instancia si `LIVE_TRADING_ENABLED ===
  "true"` **y** existen `KRAKEN_API_KEY`/`KRAKEN_API_SECRET`; en cualquier
  otro caso `LiveExecutorState` construye `FakeLiveOrderTransport`, que nunca
  hace una petición de red.
- Ni la estrategia PAPER (`bot-state.ts`, `research-lab.ts`) ni sus rutas se
  han modificado.

## Modelo de amenazas e invariantes

| Amenaza | Invariante que la mitiga |
| --- | --- |
| Activación accidental por variable de entorno mal puesta | `liveTradingEnabledFromEnv` exige el literal exacto `"true"`; ausente o cualquier otro valor es `false`. |
| Doble envío de la misma orden (reintento de red, doble clic) | `cl_ord_id` único derivado de un `idempotencyKey` persistido en `idempotencyIndex`; `prepareOrder` devuelve la orden existente en vez de crear una nueva. El transporte también deduplica por `cl_ord_id`. |
| Abrir dos posiciones o dos órdenes a la vez | `activeClOrdId` y `hasOpenPosition` bloquean estructuralmente cualquier nueva orden de apertura mientras haya una activa. |
| Orden de tamaño excesivo | `maxOrderNotionalEur` (5 EUR por defecto) se valida antes de generar el `cl_ord_id`. |
| Reventar el límite de pérdida diaria o drawdown | Guardrails de `dayStartEquityEur`/`peakEquityEur` idénticos en espíritu a los de `bot-state.ts`. |
| Actuar sobre datos de mercado obsoletos | `lastMarketDataAt` con `maxMarketDataAgeMs` (5 minutos por defecto); sin lectura reciente, todo se bloquea. |
| Fallos en cascada del transporte | `consecutiveTransportErrors` con disyuntor configurable; además cada intento de envío está acotado por `MAX_SUBMISSION_ATTEMPTS`. |
| Estado ambiguo tras timeout o respuesta ininteligible | Nunca se asume éxito ni fracaso: se transiciona a `reconciliation_required` y solo `reconcile()`/`retryReconciliation()` resuelven la verdad contra el exchange. |
| Emergencia con órdenes en curso | `emergencyCancelAll` cancela toda orden no terminal (o la cierra localmente si nunca llegó a enviarse) y activa `emergencyStopActive`, que bloquea cualquier nueva orden hasta que se despeje explícitamente. |
| Pérdida de estado por reinicio del proceso | El snapshot es un objeto plano serializable; `LiveExecutorState` lo persiste en `ctx.storage` y `test/live-executor.test.ts` verifica que un ciclo `JSON.stringify`/`JSON.parse` conserva órdenes, idempotencia y auditoría. |

## Lo que falta explícitamente para un piloto manual

Ninguno de estos pasos se ha dado en este PR:

1. Añadir una ruta HTTP autenticada (o un flujo separado) que realmente
   invoque `env.LIVE_EXECUTOR`; hoy no existe ninguna.
2. Poner `LIVE_TRADING_ENABLED=true` como secreto/variable de Cloudflare de
   forma explícita y separada de cualquier despliegue automático.
3. Conceder a la API key de Kraken los permisos mínimos de trading (sin
   retirada) y verificarlos con el auditor de permisos ya existente.
4. Definir y probar en producción el procedimiento manual de cancelación de
   emergencia (quién lo acciona, con qué credencial, en qué plazo).
5. Ejecutar la reconciliación (`reconcile`) en un cron real y decidir la
   cadencia y las alertas ante `reconciliation_required` prolongado.
6. Fijar el tamaño máximo real de piloto (el código usa 5 EUR) y el criterio
   explícito de las puertas del README ("Puertas obligatorias antes de
   operar con dinero real").
7. Revisión humana explícita y registrada del primer ciclo real antes de
   dejarlo desatendido.
