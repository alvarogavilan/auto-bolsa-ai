# Telegram trade approval readiness

`GET /api/telegram/readiness` is a read-only production probe. It verifies that the configured Telegram bot authenticates, resolves the target chat and is an administrator able to post. It never returns bot token or chat id, never creates an order, and never calls Kraken.

The trade authorization path remains one-order, short-lived and human-confirmed. A Telegram message is only created after Kraken `validate=true` succeeds for a specific prepared PAXG/EUR order.
