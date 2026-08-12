import { describe, expect, it } from "vitest";
import { liveArmingConfigurationStatus } from "../src/index-telegram-readiness";
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

  it("reports the structural live gate without arming submission", () => {
    expect(liveArmingConfigurationStatus({ TRADING_MODE: "live" } as never)).toEqual({
      tradingMode: "live",
      liveTradingEnabledConfigured: false,
      liveTradingEnabledRequested: false,
      configurationReadyForLiveReview: false,
      submissionHardBlocked: true,
      failClosed: true,
      requiredVariableName: "LIVE_TRADING_ENABLED",
    });

    expect(liveArmingConfigurationStatus({ TRADING_MODE: "live", LIVE_TRADING_ENABLED: "true" } as never)).toEqual({
      tradingMode: "live",
      liveTradingEnabledConfigured: true,
      liveTradingEnabledRequested: true,
      configurationReadyForLiveReview: true,
      submissionHardBlocked: true,
      failClosed: true,
      requiredVariableName: "LIVE_TRADING_ENABLED",
    });
  });
});
