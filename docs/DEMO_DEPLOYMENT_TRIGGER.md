# Activación de la DEMO

Último disparo de despliegue solicitado: 2026-08-01.

Este archivo no modifica la lógica del Worker. Su único objetivo es generar un nuevo commit en `main` para que la integración de despliegue conectada a GitHub detecte el cambio y publique la versión DEMO más reciente.

Seguridad conservada:

- `TRADING_MODE=paper`
- `liveTrading=false`
- órdenes reales desactivadas
- `/api/live*` bloqueado
