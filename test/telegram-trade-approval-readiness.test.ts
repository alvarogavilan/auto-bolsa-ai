import assert from "node:assert/strict";
import test from "node:test";
import { telegramTradeApprovalConfigured } from "../src/telegram-trade-approval";

test("telegram approval requires token and chat id", () => {
  assert.equal(telegramTradeApprovalConfigured({} as never), false);
  assert.equal(telegramTradeApprovalConfigured({ BETPRO_TELEGRAM_BOT_TOKEN: "token" } as never), false);
  assert.equal(telegramTradeApprovalConfigured({ BETPRO_TELEGRAM_CHAT_ID: "-1001" } as never), false);
  assert.equal(telegramTradeApprovalConfigured({
    BETPRO_TELEGRAM_BOT_TOKEN: "token",
    BETPRO_TELEGRAM_CHAT_ID: "-1001",
  } as never), true);
});
