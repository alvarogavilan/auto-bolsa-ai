# Alertas «COMPRA AHORA» / «VENDE AHORA»

Auto Bolsa **no opera por ti**. Analiza el oro (XAU/USD → PAXG/EUR en Kraken) y las crypto en EUR de Kraken, y te envía por Telegram solo dos tipos de mensaje:

| Mensaje | Qué haces |
|---|---|
| 🟢 **COMPRA AHORA** | Sigues los 5 pasos del mensaje en Kraken (orden Límite, precio e importe exactos). |
| 🔴 **VENDE AHORA** | Vendes **todo** lo comprado con esa alerta, orden a **Mercado**, aunque vaya en pérdidas. |

Si no llega ningún mensaje, **no hagas nada**.

## Reglas fijas del motor

1. Una COMPRA nace solo cuando la estrategia **abre** una posición (no en cada análisis): un mensaje por operación.
2. La COMPRA caduca (10 min oro, 15 min crypto). Si la lees tarde, no compres.
3. Solo se envía COMPRA si la estrategia tiene historial simulado suficiente y positivo:
   - Oro: ≥ 10 operaciones cerradas, resultado acumulado positivo, capital conservado, caída máxima ≤ 5 %.
   - Crypto: ≥ 14 días, ≥ 30 operaciones cerradas, resultado positivo, profit factor ≥ 1,1, caída ≤ 5 %.
4. Una VENDE solo se envía para algo que antes se mandó comprar, y nunca caduca.
5. Nunca se pide vender en corto (en Kraken Spot no puedes vender lo que no tienes).
6. Como máximo 1 posición de oro y 1 de crypto abiertas a la vez.
7. Si Telegram falla, el mensaje se reintenta en el siguiente ciclo (no se pierde ni se duplica).
8. No se compra si el precio de Kraken no es verificable o la diferencia compra/venta supera el 1 %.

## Pantalla principal

Al abrir la app (`/`) aparece **la orden a ejecutar ahora**: COMPRA, VENDE, MANTÉN o ESPERA.

- Se recalcula cada 5 segundos con el precio vivo de Kraken.
- Las compras muestran una cuenta atrás; al llegar a cero no se compra.
- Si la pantalla lleva más de 20 s sin actualizarse, o el motor lleva más de 6 min sin decidir, tapa la orden con «NO EJECUTES».
- Si el precio ya se escapó más de un 0,3 % del límite original, la compra desaparece.
- Debajo: mercado en vivo, el voto de los 9 especialistas de oro y noticias de fuentes oficiales.

El panel de simulación anterior sigue en `/demo`.

## Radar Mundial (`/radar`)

Vigilancia gratuita y sin claves de 41 fuentes: medios financieros internacionales y españoles, Google News por tema, redes públicas (Reddit, Hacker News, Mastodon, Stocktwits, CoinGecko, índice Miedo/Codicia), hechos relevantes de empresas (SEC 8-K) y un tablero de 30 mercados (índices, divisas, materias primas, empresas).

- Calcula un pulso por tema (oro, Bitcoin, bolsa, macro, geopolítica…) con el tono de medios y de redes por separado.
- **Es informativo: no cambia ninguna orden.** El tono de titulares no ha demostrado mejorar el resultado en simulación.
- Cada fuente muestra si responde o no; una fuente caída nunca rompe el radar.
- X/Twitter, Bloomberg y Reuters no tienen acceso gratuito y no están incluidos.

## Endpoints

| Ruta | Uso |
|---|---|
| `GET /api/order-now` | La orden vigente (lo que pinta la pantalla principal). |
| `GET /api/radar` | Radar Mundial completo (caché 3 min). |
| `GET /api/world-markets` | Tablero mundial de mercados (caché 1 min). |
| `GET /api/news-brief` | Titulares de fuentes oficiales (caché 2 min). |
| `GET /api/signals/status` | Qué deberías tener comprado ahora y últimas alertas. |
| `POST /api/signals/test` (ADMIN_TOKEN) | Envía un mensaje de prueba a Telegram. |
| `POST /api/signals/run` (ADMIN_TOKEN) | Fuerza un ciclo de alertas y devuelve el detalle (incluye señales descartadas por falta de evidencia). |
| `POST /api/signals/reset-holding?key=gold` (ADMIN_TOKEN) | Olvida una posición si no la llegaste a comprar. |

Secretos necesarios en Cloudflare: `TELEGRAM_BOT_TOKEN` y `TELEGRAM_CHAT_ID` (o los alias `BETPRO_*`).

> Las señales se basan en simulación. Un historial simulado positivo no garantiza beneficios reales. Invierte solo importes que puedas permitirte perder.
