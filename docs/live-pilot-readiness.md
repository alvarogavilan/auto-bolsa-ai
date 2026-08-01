# Informe de preparación para un piloto LIVE (solo lectura)

`src/live-pilot-readiness.ts` añade un módulo **de solo lectura** que calcula,
a partir de entradas explícitas, si el conjunto de infraestructura LIVE ya
construida (guardrails, permisos, metadatos de par, orden preparada,
preflight, certificado, journal, reconciliación, emergencia) estaría lista
para una futura **revisión manual humana** de un piloto real. No activa
trading, no añade ningún camino nuevo hacia Kraken y no modifica ninguno de
los módulos LIVE existentes.

## Qué es y qué no es

- Es una función pura: `calculateLivePilotReadiness(inputs, now?)`. No lee
  `env`, no llama a `fetch`, no toca `ctx.storage`, no importa credenciales.
- No decide nada por sí sola. Su único campo de salida orientado a decisión,
  `eligibleForManualPilotReview`, documenta que el sistema **podría pasar a
  revisión manual**; nunca ejecuta, prepara ni envía una orden, ni siquiera
  cuando es `true`.
- No sustituye ni envuelve a `evaluateLiveGuardrails`, `calculatePaperReadiness`,
  el certificado de preflight o el journal de envío: los consume ya calculados.
  Quien construya `LivePilotReadinessInputs` es responsable de haber obtenido
  cada valor sin exponer secretos (ver más abajo).
- No se importa desde `src/index.ts`, no tiene binding, ruta, cron ni botón.
  `/api/live*` sigue devolviendo `403 LIVE_TRADING_HARD_DISABLED` exactamente
  igual que antes; este módulo no toca esa ruta.

## Entradas (`LivePilotReadinessInputs`)

| Sección | Origen esperado | Nota |
| --- | --- | --- |
| `paper` | Salida sin modificar de `calculatePaperReadiness` (`src/paper-readiness.ts`) | Único punto de verdad para la evidencia PAPER; el informe no reimplementa sus umbrales. |
| `demo.status` | `ShadowLiveDemoStatus` de `buildShadowLiveDemo` (`src/shadow-live-demo.ts`) | Solo el estado; nunca cifras de la estrategia seleccionada. |
| `guardrails` | Salida sin modificar de `evaluateLiveGuardrails` (`src/live-guardrails.ts`) para la orden preparada actual | El informe no reevalúa las puertas: solo agrega `allowed`/`blockers`. |
| `krakenPermissions.{auditComplete,safePermissions}` | Los dos booleanos de `BotState.krakenPermissions()` (`src/bot-state.ts`) | **Deliberadamente excluidos**: la lista completa de permisos, `apiKeyName`, `expiresAt`, `ipRestrictionEnabled`. |
| `pairMetadata.{resolved,stale}` | Derivado de `LivePairResolution`/caché de `LiveExecutorState` | Sin exponer el contenido de `AssetPairs`, solo si está resuelto y si sigue fresco. |
| `preparedOrder.exists` | `LiveExecutorSnapshot.activeClOrdId !== null` con `status === "prepared"` o superior | Confirma que existe una orden que ha atravesado el flujo, sin exponer sus datos económicos. |
| `preflightCertificate.status` | Resultado ya evaluado de `checkLivePreflightCertificate` (`"valid" \| "expired" \| "consumed" \| "invalid" \| "absent"`) | El informe no recalcula huellas ni fechas; consume la conclusión. |
| `submissionJournal.phase` | `"none"` o la fase de `LiveSubmissionJournalEntry` (`src/live-submission-journal.ts`) | `"none"` cuando no existe entrada para la orden preparada actual. |
| `reconciliation.{everRun,ok,balanceStatus,unresolvedOrderCount}` | Resumen del último `LiveVerifiedReconciliationReport` (`src/live-verified-reconciliation.ts`) | `balanceStatus` añade `"never_checked"` para distinguir "nunca se ejecutó" de `"unknown"` (falló el chequeo). |
| `emergency.{active,manualLiquidationPending}` | `LiveExecutorSnapshot.emergencyStopActive` / `emergencyStopRequiresManualLiquidation` | Igual que el resto, sin exponer el texto libre de `emergencyStopReason`. |

Todos los campos son explícitos: no hay valores por defecto ocultos ni lectura
implícita de `Date.now()` salvo el parámetro `now` del propio informe
(`generatedAt`), que también se puede fijar en pruebas.

## Salida (`LivePilotReadinessReport`)

```
{
  schemaVersion: "live-pilot-readiness-v1",
  generatedAt: number,
  liveTrading: false,
  sections: { paper, demo, guardrails, krakenPermissions, pairMetadata,
              preparedOrder, preflightCertificate, submissionJournal,
              reconciliation, emergency },
  blockers: string[],
  warnings: string[],
  passedChecks: string[],
  eligibleForManualPilotReview: boolean,
  message: string,
}
```

- `blockers`: cualquier condición que impide la revisión manual. Cada entrada
  de `paper.checks` que sea `false` genera un blocker propio (evidencia PAPER
  insuficiente sigue bloqueando aunque el resto de la infraestructura esté
  completa). Un certificado ausente/caducado/consumido/inválido, una
  reconciliación nunca ejecutada/incompleta/con balance no consistente/con
  órdenes sin resolver, o una emergencia activa/liquidación manual pendiente
  generan blockers explícitos.
- `warnings`: condiciones informativas que no bloquean por sí solas la
  revisión (por ejemplo, el DEMO todavía inicializando o detenido por un
  límite de seguridad propio, sin errores).
- `passedChecks`: lista positiva espejo de `blockers`, para que el informe
  documente también lo que sí está resuelto.
- `eligibleForManualPilotReview`: `true` únicamente cuando `blockers` está
  vacío **y** `paper.eligibleForLiveReview` es `true`. Nunca activa, prepara
  ni envía nada; el propio tipo del campo `liveTrading` es el literal
  `false`, no un booleano configurable.

## Cómo se cumplen las reglas inmutables de la issue

- No se ha tocado `src/live-executor.ts`, `src/live-executor-state.ts`,
  `src/live-certified-submission.ts`, `src/live-preflight-certificate-store.ts`,
  `wrangler.jsonc` ni `src/index.ts`. Este PR solo añade
  `src/live-pilot-readiness.ts`, `test/live-pilot-readiness.test.ts` y este
  documento.
- No se añade ningún binding, ruta, cron, botón ni variable de entorno LIVE.
- No se modifica la estrategia PAPER, sus comisiones ni sus umbrales:
  `paper-readiness.ts` se importa solo por su tipo `PaperReadiness`, sin
  tocar su código.
- No se usan credenciales ni secretos: el módulo no importa `kraken.ts`,
  `live-transport.ts` ni ningún fichero que realice peticiones de red.
- El PR permanece abierto y sin fusionar a la espera de revisión.
- `/api/live*` sigue devolviendo 403 y `TRADING_MODE` sigue en `paper`.

## Pruebas mínimas cubiertas (`test/live-pilot-readiness.test.ts`)

- Estado inicial: todo bloqueado.
- Evidencia PAPER insuficiente bloquea aunque el resto de la infraestructura
  esté completa.
- Certificado ausente, caducado, consumido o inválido: no elegible en cada
  caso.
- Reconciliación nunca ejecutada, balance `"unknown"`/`"inconsistent"` u
  órdenes sin resolver: no elegible en cada caso.
- Emergencia activa o liquidación manual pendiente: no elegible en cada caso.
- Guardrails con cualquier blocker, metadatos de par obsoletos, journal no
  reconciliado o DEMO en error: no elegible en cada caso.
- Elegible únicamente para revisión manual (nunca para ejecución) cuando
  todas las entradas son válidas; el mensaje nunca sugiere ejecución.
- El informe no contiene fragmentos de secretos/credenciales y los permisos
  Kraken solo exponen los dos booleanos de auditoría.
- La función es pura: mismas entradas y mismo reloj producen el mismo informe.
