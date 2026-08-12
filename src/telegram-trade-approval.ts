import type { Env } from "./types";

export interface TelegramTradeApprovalMessage {
  approvalUrl: string;
  pair: string;
  side: "buy" | "sell";
  notionalEur: number;
  limitPrice: number;
  stopPrice?: number | null;
  expiresAt: number;
}

function telegramToken(env: Env): string | null {
  return env.TELEGRAM_BOT_TOKEN?.trim() || env.BETPRO_TELEGRAM_BOT_TOKEN?.trim() || null;
}

function telegramChatId(env: Env): string | null {
  return env.TELEGRAM_CHAT_ID?.trim() || env.BETPRO_TELEGRAM_CHAT_ID?.trim() || null;
}

export function telegramTradeApprovalConfigured(env: Env): boolean {
  return Boolean(telegramToken(env) && telegramChatId(env));
}

export async function sendTelegramTradeApproval(
  env: Env,
  message: TelegramTradeApprovalMessage,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const token = telegramToken(env);
  const chatId = telegramChatId(env);
  if (!token || !chatId) return { ok: false, status: 0, error: "TELEGRAM_APPROVAL_NOT_CONFIGURED" };

  const expires = new Date(message.expiresAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" });
  const text = [
    "🟡 AUTO BOLSA · AUTORIZACIÓN NECESARIA",
    "",
    `${message.side === "buy" ? "Comprar" : "Vender"} ${message.pair}`,
    `Importe máximo: ${message.notionalEur.toFixed(2)} €`,
    `Precio límite: ${message.limitPrice}`,
    message.stopPrice && message.stopPrice > 0 ? `Stop inicial: ${message.stopPrice}` : null,
    `Caduca: ${expires}`,
    "",
    "La orden ya ha pasado el preflight validate=true. No se enviará dinero hasta que confirmes esta operación concreta.",
  ].filter(Boolean).join("\n");

  const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "✅ Revisar y autorizar operación", url: message.approvalUrl }]],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: body.slice(0, 240) || `HTTP_${response.status}` };
  }
  return { ok: true, status: response.status };
}
