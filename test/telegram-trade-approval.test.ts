import { describe, expect, it } from "vitest";
import { telegramTradeApprovalConfigured } from "../src/telegram-trade-approval";

describe("telegram trade approval configuration", () => {
  it("fails closed without bot token and chat id", () => {
    expect(telegramTradeApprovalConfigured({} as never)).toBe(false);
  });

  it("accepts BetPro-compatible secret aliases", () => {
    expect(telegramTradeApprovalConfigured({
      BETPRO_TELEGRAM_BOT_TOKEN: "token",
      BETPRO_TELEGRAM_CHAT_ID: "-100123",
    } as never)).toBe(true);
  });
});
