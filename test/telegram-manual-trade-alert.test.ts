import { afterEach, describe, expect, it, vi } from "vitest";
import { sendTelegramManualTradeAlert } from "../src/telegram-manual-trade-alert";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("manual Telegram trade alerts", () => {
  it("sends actionable manual Kraken details without approval or real submission controls", async () => {
    let requestBody: Record<string, unknown> | null = null;
    globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      requestBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    const result = await sendTelegramManualTradeAlert({
      BETPRO_TELEGRAM_BOT_TOKEN: "test-token",
      BETPRO_TELEGRAM_CHAT_ID: "-1004476828218",
    } as never, {
      pair: "PAXGEUR",
      side: "buy",
      notionalEur: 9.75,
      limitPrice: 4032.12,
      volumeBase: 0.002418,
      xauReferencePrice: 4066.1,
      xauStopPrice: 4055.5,
      xauTargetPrice: 4092.2,
      generatedAt: Date.UTC(2026, 7, 14, 10, 0, 0),
    });

    expect(result.ok).toBe(true);
    expect(requestBody?.chat_id).toBe("-1004476828218");
    const text = String(requestBody?.text ?? "");
    expect(text).toContain("OPERACIÓN PARA EJECUCIÓN MANUAL");
    expect(text).toContain("PAXGEUR");
    expect(text).toContain("9.75 €");
    expect(text).toContain("NO ha enviado ninguna orden a Kraken");
    expect(text).not.toContain("APROBAR");
    expect(text).not.toContain("RECHAZAR");

    const markup = requestBody?.reply_markup as { inline_keyboard?: Array<Array<{ text?: string; url?: string }>> } | undefined;
    expect(markup?.inline_keyboard?.[0]?.[0]?.text).toBe("📱 ABRIR KRAKEN");
    expect(markup?.inline_keyboard?.[0]?.[0]?.url).toBe("https://pro.kraken.com/");
  });

  it("fails closed when Telegram is not configured", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await sendTelegramManualTradeAlert({} as never, {
      pair: "PAXGEUR",
      side: "sell",
      notionalEur: 5,
      limitPrice: 4000,
      generatedAt: Date.now(),
    });
    expect(result).toEqual({ ok: false, status: 503, error: "TELEGRAM_NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
