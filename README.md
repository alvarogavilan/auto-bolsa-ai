# Auto Bolsa AI

Motor de trading automatizado para Kraken Spot, con simulación, gestión estricta de riesgo y control desde iPhone.

## Estado actual

- **Modo PAPER obligatorio**: no envía órdenes reales.
- Trading real bloqueado por código en todas las rutas `/api/live/*`.
- Consulta velas públicas de Kraken para `XBTEUR` cada cinco minutos.
- Estrategia inicial: cruce EMA 9/21, filtro RSI 14, stop loss y take profit.
- Capital simulado inicial: 50 EUR.
- Exposición máxima: 20% del efectivo y máximo 10 EUR por entrada.
- Límite de pérdida diaria: 1%.
- Drawdown máximo: 5%.
- Sin margen, futuros, apalancamiento, martingala ni retiradas.

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
