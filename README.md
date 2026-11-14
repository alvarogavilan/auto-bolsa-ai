# Auto Bolsa AI

Motor de trading automatizado para Kraken Spot, con simulación, gestión estricta de riesgo y control desde iPhone.

## Estado actual

- **Ejecución manual**: Auto Bolsa no envía órdenes reales (`LIVE_TRADING_ENABLED` ausente). Te avisa por Telegram con «🟢 COMPRA AHORA» / «🔴 VENDE AHORA» y tú ejecutas en Crypto.com. Ver [docs/ALERTAS_COMPRA_VENTA.md](docs/ALERTAS_COMPRA_VENTA.md).
- **Oro (especialidad)**: gabinete técnico + macro sobre XAU/USD cada minuto, con muestreo rápido de precio; se ejecuta como PAXG/EUR en Crypto.com.
- **Crypto**: laboratorio multi‑horizonte (rápido, intradía, swing) sobre los pares EUR más líquidos de Kraken.
- Solo se alerta una estrategia con historial simulado suficiente y positivo; las demás siguen en simulación.
- Sin margen, futuros, apalancamiento, cortos ni martingala.
- El ejecutor LIVE automático sigue encapsulado y desactivado: ver [docs/live-executor.md](docs/live-executor.md).

## Arquitectura

Cloudflare Worker + Cron Trigger + Durable Object. El iPhone es el único dispositivo de control; la ejecución continua ocurre en Cloudflare.

## Desarrollo

```bash
npm install
npm run typecheck
npm test
npm run dev
```

## Despliegue

1. Conectar este repositorio a Cloudflare Workers.
2. Crear el secreto `ADMIN_TOKEN` en **Settings → Variables and Secrets**.
3. No añadir todavía las claves de Kraken: la versión 0.1 no las necesita.
4. Desplegar y comprobar `/health`, `/api/status` y el panel `/`.

Los archivos `.dev.vars*` y `.env*` están ignorados. Las credenciales nunca deben guardarse en GitHub.

## Puertas obligatorias antes de operar con dinero real

1. CI verde.
2. Simulación continua y persistente durante un periodo suficiente.
3. Métricas completas: rentabilidad neta, drawdown, ratio de aciertos y costes.
4. Revisión del tamaño mínimo de las órdenes y comisiones reales.
5. Interruptor de emergencia probado.
6. Activación explícita y separada del módulo real; nunca automática desde una actualización.
