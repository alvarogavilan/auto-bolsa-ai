import { DurableObject } from "cloudflare:workers";
import { fetchOhlc } from "./kraken";
import { calculateIndicators, decide } from "./strategy";
import type { BotConfig, BotSnapshot, Env, PaperTrade } from "./types";

const STORAGE_KEY = "snapshot";
const VERSION = "0.1.0-paper";

function utcDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function money(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function defaultConfig(pair: string): BotConfig {
  return {
    pair,
    fastPeriod: 9,
    slowPeriod: 21,
    rsiPeriod: 14,
    maxExposurePct: 0.2,
    maxDailyLossPct: 0.01,
    maxDrawdownPct: 0.05,
    stopLossPct: 0.02,
    takeProfitPct: 0.03,
    cooldownMinutes: 60,
    feePct: 0.004,
    slippagePct: 0.001,
  };
}

function initialSnapshot(env: Env): BotSnapshot {
  const initialCash = Number(env.INITIAL_CASH_EUR || "50");
  const now = Date.now();
  return {
    version: VERSION,
    mode: "paper",
    paused: false,
    initialCashEur: initialCash,
    cashEur: initialCash,
    position: null,
    equityEur: initialCash,
    peakEquityEur: initialCash,
    dayStartEquityEur: initialCash,
    dayKey: utcDay(now),
    lastPrice: null,
    lastTickAt: null,
    lastTradeAt: null,
    lastDecision: "Esperando primer ciclo",
    config: defaultConfig(env.PAIR || "XBTEUR"),
    trades: [],
  };
}

export class BotState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private async read(): Promise<BotSnapshot> {
    return (await this.ctx.storage.get<BotSnapshot>(STORAGE_KEY)) ?? initialSnapshot(this.env);
  }

  private async write(snapshot: BotSnapshot): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, snapshot);
  }

  private equity(snapshot: BotSnapshot, price: number): number {
    return money(snapshot.cashEur + (snapshot.position?.quantity ?? 0) * price);
  }

  private inCooldown(snapshot: BotSnapshot, now: number): boolean {
    if (snapshot.lastTradeAt === null) return false;
    return now - snapshot.lastTradeAt < snapshot.config.cooldownMinutes * 60_000;
  }

  private riskBlocked(snapshot: BotSnapshot): string | null {
    const dailyLoss = (snapshot.dayStartEquityEur - snapshot.equityEur) / snapshot.dayStartEquityEur;
    if (dailyLoss >= snapshot.config.maxDailyLossPct) return "Límite de pérdida diaria alcanzado";
    const drawdown = (snapshot.peakEquityEur - snapshot.equityEur) / snapshot.peakEquityEur;
    if (drawdown >= snapshot.config.maxDrawdownPct) return "Límite de drawdown alcanzado";
    return null;
  }

  private addTrade(snapshot: BotSnapshot, trade: PaperTrade): void {
    snapshot.trades = [trade, ...snapshot.trades].slice(0, 100);
  }

  private buy(snapshot: BotSnapshot, rawPrice: number, now: number, reason: string): void {
    const price = rawPrice * (1 + snapshot.config.slippagePct);
    const grossBudget = Math.min(snapshot.cashEur * snapshot.config.maxExposurePct, 10);
    if (grossBudget < 2) {
      snapshot.lastDecision = "Compra omitida: capital disponible insuficiente";
      return;
    }
    const fee = grossBudget * snapshot.config.feePct;
    const cost = grossBudget + fee;
    if (cost > snapshot.cashEur) {
      snapshot.lastDecision = "Compra omitida: saldo insuficiente tras comisiones";
      return;
    }
    const quantity = grossBudget / price;
    snapshot.cashEur = money(snapshot.cashEur - cost);
    snapshot.position = {
      asset: "BTC",
      quantity,
      entryPrice: price,
      entryTime: now,
      stopLoss: price * (1 - snapshot.config.stopLossPct),
      takeProfit: price * (1 + snapshot.config.takeProfitPct),
      costEur: cost,
    };
    snapshot.lastTradeAt = now;
    snapshot.lastDecision = `PAPER BUY: ${reason}`;
    this.addTrade(snapshot, {
      id: crypto.randomUUID(),
      side: "buy",
      price,
      quantity,
      grossEur: grossBudget,
      feeEur: fee,
      timestamp: now,
      reason,
    });
  }

  private sell(snapshot: BotSnapshot, rawPrice: number, now: number, reason: string): void {
    const position = snapshot.position;
    if (!position) return;
    const price = rawPrice * (1 - snapshot.config.slippagePct);
    const gross = position.quantity * price;
    const fee = gross * snapshot.config.feePct;
    const proceeds = gross - fee;
    const pnl = proceeds - position.costEur;
    snapshot.cashEur = money(snapshot.cashEur + proceeds);
    snapshot.position = null;
    snapshot.lastTradeAt = now;
    snapshot.lastDecision = `PAPER SELL: ${reason}`;
    this.addTrade(snapshot, {
      id: crypto.randomUUID(),
      side: "sell",
      price,
      quantity: position.quantity,
      grossEur: gross,
      feeEur: fee,
      timestamp: now,
      reason,
      pnlEur: pnl,
    });
  }

  private async tick(): Promise<BotSnapshot> {
    const snapshot = await this.read();
    const now = Date.now();

    if (utcDay(now) !== snapshot.dayKey) {
      snapshot.dayKey = utcDay(now);
      snapshot.dayStartEquityEur = snapshot.equityEur;
    }

    if (snapshot.paused) {
      snapshot.lastTickAt = now;
      snapshot.lastDecision = "Pausado por el usuario";
      await this.write(snapshot);
      return snapshot;
    }

    const candles = await fetchOhlc(snapshot.config.pair, 15);
    const indicators = calculateIndicators(
      candles,
      snapshot.config.fastPeriod,
      snapshot.config.slowPeriod,
      snapshot.config.rsiPeriod,
    );

    snapshot.lastPrice = indicators.price;
    snapshot.lastTickAt = now;
    snapshot.equityEur = this.equity(snapshot, indicators.price);
    snapshot.peakEquityEur = Math.max(snapshot.peakEquityEur, snapshot.equityEur);

    if (snapshot.position && indicators.price <= snapshot.position.stopLoss) {
      this.sell(snapshot, indicators.price, now, "Stop loss automático");
    } else if (snapshot.position && indicators.price >= snapshot.position.takeProfit) {
      this.sell(snapshot, indicators.price, now, "Take profit automático");
    } else {
      const riskBlock = this.riskBlocked(snapshot);
      if (riskBlock) {
        snapshot.lastDecision = riskBlock;
        snapshot.paused = true;
      } else if (this.inCooldown(snapshot, now)) {
        snapshot.lastDecision = "Cooldown de seguridad activo";
      } else {
        const signal = decide(indicators, snapshot.position !== null);
        if (signal.action === "buy") this.buy(snapshot, indicators.price, now, signal.reason);
        else if (signal.action === "sell") this.sell(snapshot, indicators.price, now, signal.reason);
        else snapshot.lastDecision = signal.reason;
      }
    }

    snapshot.equityEur = this.equity(snapshot, indicators.price);
    snapshot.peakEquityEur = Math.max(snapshot.peakEquityEur, snapshot.equityEur);
    await this.write(snapshot);
    return snapshot;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/tick") {
        return Response.json(await this.tick());
      }
      if (request.method === "POST" && url.pathname === "/pause") {
        const snapshot = await this.read();
        snapshot.paused = true;
        snapshot.lastDecision = "Pausado manualmente";
        await this.write(snapshot);
        return Response.json(snapshot);
      }
      if (request.method === "POST" && url.pathname === "/resume") {
        const snapshot = await this.read();
        snapshot.paused = false;
        snapshot.lastDecision = "Reanudado manualmente";
        await this.write(snapshot);
        return Response.json(snapshot);
      }
      if (request.method === "POST" && url.pathname === "/reset") {
        const snapshot = initialSnapshot(this.env);
        await this.write(snapshot);
        return Response.json(snapshot);
      }
      if (request.method === "GET" && url.pathname === "/status") {
        return Response.json(await this.read());
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown bot error";
      const snapshot = await this.read();
      snapshot.lastTickAt = Date.now();
      snapshot.lastDecision = `ERROR: ${message}`;
      await this.write(snapshot);
      return Response.json({ error: message, snapshot }, { status: 500 });
    }
  }
}
