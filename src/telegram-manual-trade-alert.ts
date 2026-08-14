import type { Env } from "./types";

const TELEGRAM_API = "https://api.telegram.org";
const KRAKEN_MANUAL_URL = "https://pro.kraken.com/";

export interface TelegramManualTradeAlert {
  pair: string;
  side: "buy" | "sell";
  notionalEur: number;
  limitPrice: number;
  volumeBase?: number | null;
  xauReferencePrice?: number | null;
  xauStopPrice?: number | null;
  xauTargetPrice?: number | null;
  generatedAt: number;
}

function botToken(env: Env): string | null {
  const token = env.TELEGRAM_BOT_TOKEN || env.BETPRO_TELEGRAM_BOT_TOKEN;
  return typeof token === "string" && token.trim() ? token.trim() : null;
}

function chatId(env: Env): string | null {
  const id = env.TELEGRAM_CHAT_ID || env.BETPRO_TELEGRAM_CHAT_ID;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

function number(value: number | null | undefined, decimals = 6): string {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(decimals) : "—";
}

export async function sendTelegramManualTradeAlert(
  env: Env,
  alert: TelegramManualTradeAlert,
): Promise<{ ok: boolean; status: number; error?: string }> {
  const token = botToken(env);
  const destination = chatId(env);
  if (!token || !destination) return { ok: false, status: 503, error: "TELEGRAM_NOT_CONFIGURED" };

  const action = alert.side === "buy" ? "🟢 COMPRAR" : "🔴 VENDER";
  const lines = [
    "📣 AUTO BOLSA · OPERACIÓN PARA EJECUCIÓN MANUAL",
    "",
    `Acción: ${action}`,
    `Par en Kraken: ${alert.pair}`,
    `Importe orientativo: ${alert.notionalEur.toFixed(2)} €`,
    `Precio límite PAXG/EUR: ${number(alert.limitPrice, 2)}`,
    alert.volumeBase ? `Cantidad PAXG aproximada: ${number(alert.volumeBase, 8)}` : null,
    "",
    "Referencia de la señal XAU/USD:",
    `Entrada: ${number(alert.xauReferencePrice, 2)}`,
    `Stop de referencia: ${number(alert.xauStopPrice, 2)}`,
    `Objetivo de referencia: ${number(alert.xauTargetPrice, 2)}`,
    "",
    `Generada: ${new Date(alert.generatedAt).toLocaleString("es-ES", { timeZone: "Europe/Madrid" })}`,
    "",
    "⚠️ EJECUCIÓN MANUAL: Auto Bolsa NO ha enviado ninguna orden a Kraken. Abre Kraken, comprueba precio/saldo y confirma tú la operación. Los niveles XAU/USD son referencia de la señal y no deben copiarse como precios PAXG/EUR.",
  ].filter((line): line is string => Boolean(line));

  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: destination,
      text: lines.join("\n"),
      disable_web_page_preview: true,
      reply_markup: {
        inline_keyboard: [[{ text: "📱 ABRIR KRAKEN", url: KRAKEN_MANUAL_URL }]],
      },
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { ok: false, status: response.status, error: body.slice(0, 500) || "TELEGRAM_SEND_FAILED" };
  }
  return { ok: true, status: response.status };
}
