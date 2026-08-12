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

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export async function telegramTradeApprovalReadiness(env: Env): Promise<{
  configured: boolean;
  connected: boolean;
  chatResolved: boolean;
  botIsMember: boolean;
  botCanPost: boolean;
  status: string | null;
  error: string | null;
}> {
  const token = telegramToken(env);
  const chatId = telegramChatId(env);
  if (!token || !chatId) {
    return { configured: false, connected: false, chatResolved: false, botIsMember: false, botCanPost: false, status: null, error: "TELEGRAM_APPROVAL_NOT_CONFIGURED" };
  }

  try {
    const meResponse = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const meBody = object(await meResponse.json().catch(() => ({})));
    const meResult = object(meBody.result);
    const botId = Number(meResult.id);
    if (!meResponse.ok || meBody.ok !== true || !Number.isFinite(botId)) {
      return { configured: true, connected: false, chatResolved: false, botIsMember: false, botCanPost: false, status: null, error: "TELEGRAM_BOT_AUTH_FAILED" };
    }

    const chatResponse = await fetch(`https://api.telegram.org/bot${token}/getChat?chat_id=${encodeURIComponent(chatId)}`);
    const chatBody = object(await chatResponse.json().catch(() => ({})));
    if (!chatResponse.ok || chatBody.ok !== true) {
      return { configured: true, connected: true, chatResolved: false, botIsMember: false, botCanPost: false, status: null, error: "TELEGRAM_CHAT_NOT_RESOLVED" };
    }

    const memberResponse = await fetch(`https://api.telegram.org/bot${token}/getChatMember?chat_id=${encodeURIComponent(chatId)}&user_id=${encodeURIComponent(String(botId))}`);
    const memberBody = object(await memberResponse.json().catch(() => ({})));
    const member = object(memberBody.result);
    const status = typeof member.status === "string" ? member.status : null;
    const botIsMember = memberResponse.ok && memberBody.ok === true && status !== null && status !== "left" && status !== "kicked";
    const administrator = status === "administrator" || status === "creator";
    const canPostMessages = member.can_post_messages !== false;
    const botCanPost = botIsMember && administrator && canPostMessages;

    return {
      configured: true,
      connected: true,
      chatResolved: true,
      botIsMember,
      botCanPost,
      status,
      error: botCanPost ? null : "TELEGRAM_BOT_CANNOT_POST",
    };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      chatResolved: false,
      botIsMember: false,
      botCanPost: false,
      status: null,
      error: error instanceof Error ? error.message : "TELEGRAM_READINESS_FAILED",
    };
  }
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
