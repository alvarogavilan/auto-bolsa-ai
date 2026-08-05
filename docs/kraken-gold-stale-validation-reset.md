# Reinicio seguro de validación al cambiar a PAXG/EUR

Cuando el par configurado cambia de `XBTEUR` a `PAXGEUR`, una propuesta `validate=true` antigua puede permanecer en el Durable Object.

El Worker solo elimina automáticamente esa propuesta si está en estado `prepared`, nunca tuvo `exchangeOrderId`, no registra intentos ni fills, no existe inventario y tampoco existe journal de envío. Cualquier evidencia distinta mantiene el estado bloqueado para reconciliación manual.

Esta migración no activa LIVE, no envía órdenes y no modifica permisos de retirada.
