import { describe, expect, it } from "vitest";
import { telegramTradeApprovalConfigured } from "../src/telegram-trade-approval";

describe("Telegram trade approval readiness", () => {
  it("requires both token and chat id", () => {
    expect(telegramTradeApprovalConfigured({} as never)).toBe(false);
    expect(telegramTradeApprovalConfigured({ BETPRO_TELEGRAM_BOT_TOKEN: "token" } as never)).toBe(false);
    expect(telegramTradeApprovalConfigured({ BETPRO_TELEGRAM_CHAT_ID: "-1001" } as never)).toBe(false);
    expect(telegramTradeApprovalConfigured({
      BETPRO_TELEGRAM_BOT_TOKEN: "token",
      BETPRO_TELEGRAM_CHAT_ID: "-1001",
    } as never)).toBe(true);
  });
});
