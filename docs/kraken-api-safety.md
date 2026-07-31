# Seguridad de la API de Kraken

- Todas las llamadas privadas pasan por un único Durable Object para serializar el `nonce`.
- Se conserva la escala de microsegundos ya utilizada por esta clave y se incrementa de forma persistente.
- Un error `EGeneral:Temporary lockout` activa un bloqueo local de 15 minutos para impedir reintentos que prolonguen el bloqueo de Kraken.
- Las órdenes reales permanecen deshabilitadas.
- La firma se valida en CI con el vector oficial publicado por Kraken.
