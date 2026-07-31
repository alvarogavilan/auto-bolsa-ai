import { DurableObject } from "cloudflare:workers";
import { fetchBalance, fetchOhlc, inspectKrakenCredentials } from "./kraken";
import { selectMarketObservation } from "./market-evidence";
import { calculatePaperReadiness } from "./paper-readiness";
import { calculateIndicators, decide } from "./strategy";
import type { BotConfig, BotSnapshot, Env, PaperPerformance, PaperTrade } from "./types";

const STORAGE_KEY = "snapshot";
const KRAKEN_NONCE_KEY = "kraken-last-nonce";
const KRAKEN_LOCKOUT_UNTIL_KEY = "kraken-lockout-until";
const KRAKEN_LOCKOUT_MS = 15 * 60_000;
const VERSION = "0.10.0-paper";

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

function emptyPerformance(): PaperPerformance {
  return {
    buyTrades: 0,
    sellTrades: 0,
    closedTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    grossProfitEur: 0,
    grossLossEur: 0,
    netPnlEur: 0,
    totalFeesEur: 0,
  };
}

function derivePerformance(trades: PaperTrade[]): PaperPerformance {
  const performance = emptyPerformance();
  for (const trade of trades) {
    performance.totalFeesEur = money(performance.totalFeesEur + trade.feeEur);
    if (trade.side === "buy") {
      performance.buyTrades += 1;
      continue;
    }

    performance.sellTrades += 1;
    if (typeof trade.pnlEur !== "number") continue;
    performance.closedTrades += 1;
    performance.netPnlEur = money(performance.netPnlEur + trade.pnlEur);
    if (trade.pnlEur > 0) {
      performance.winningTrades += 1;
      performance.grossProfitEur = money(performance.grossProfitEur + trade.pnlEur);
    } else if (trade.pnlEur < 0) {
      performance.losingTrades += 1;
      performance.grossLossEur = money(performance.grossLossEur + Math.abs(trade.pnlEur));
    }
  }
  return performance;
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
    paperStartedAt: now,
    evidenceStartedAt: now,
    evidenceMethod: "closed-15m-candles-v1",
    ticksObserved: 0,
    uniqueClosedCandlesObserved: 0,
    duplicateCandleSkips: 0,
    errorsObserved: 0,
    maxObservedDrawdownPct: 0,
    lastClosedCandleTime: null,
    lastPrice: null,
    lastTickAt: null,
    lastTradeAt: null,
    lastDecision: "Esperando primera vela cerrada",
    config: defaultConfig(env.PAIR || "XBTEUR"),
    performance: emptyPerformance(),
    trades: [],
  };
}

export class BotState extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private async read(): Promise<BotSnapshot> {
    const fallback = initialSnapshot(this.env);
    const stored = await this.ctx.storage.get<Partial<BotSnapshot>>(STORAGE_KEY);
    if (!stored) return fallback;

    const trades = Array.isArray(stored.trades) ? stored.trades : [];
    return {
      ...fallback,
      ...stored,
      version: VERSION,
      mode: "paper",
      paperStartedAt: stored.paperStartedAt ?? stored.lastTickAt ?? Date.now(),
      evidenceStartedAt: stored.evidenceStartedAt ?? Date.now(),
      evidenceMethod: "closed-15m-candles-v1",
      ticksObserved: stored.ticksObserved ?? 0,
      uniqueClosedCandlesObserved: stored.uniqueClosedCandlesObserved ?? 0,
      duplicateCandleSkips: stored.duplicateCandleSkips ?? 0,
      errorsObserved: stored.errorsObserved ?? 0,
      maxObservedDrawdownPct: stored.maxObservedDrawdownPct ?? 0,
      lastClosedCandleTime: stored.lastClosedCandleTime ?? null,
      config: { ...fallback.config, ...(stored.config ?? {}) },
      performance: stored.performance ?? derivePerformance(trades),
      trades,
    };
  }

  private async write(snapshot: BotSnapshot): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, snapshot);
  }

  private updateObservedDrawdown(snapshot: BotSnapshot): void {
    if (snapshot.peakEquityEur <= 0) return;
    const current = Math.max(0, (snapshot.peakEquityEur - snapshot.equityEur) / snapshot.peakEquityEur);
    snapshot.maxObservedDrawdownPct = Math.max(snapshot.maxObservedDrawdownPct, current);
  }

  private async nextKrakenNonce(): Promise<string> {
    const stored = await this.ctx.storage.get<string>(KRAKEN_NONCE_KEY);
    const last = stored ? BigInt(stored) : 0n;
    const timeBased = BigInt(Date.now()) * 1000n;
    const next = timeBased > last ? timeBased : last + 1n;
    const value = next.toString();
    await this.ctx.storage.put(KRAKEN_NONCE_KEY, value);
    return value;
  }

  private krakenDiagnostics(): Response {
    if (!this.env.KRAKEN_API_KEY || !this.env.KRAKEN_API_SECRET) {
      return Response.json(
        {
          configured: false,
          networkCall: false,
          message: "Faltan los secretos KRAKEN_API_KEY y KRAKEN_API_SECRET en Cloudflare.",
          liveTrading: false,
        },
        { status: 412 },
      );
    }

    return Response.json({
      configured: true,
      networkCall: false,
      ...inspectKrakenCredentials(this.env.KRAKEN_API_KEY, this.env.KRAKEN_API_SECRET),
      message: "Diagnóstico local completado sin contactar con Kraken.",
      liveTrading: false,
    });
  }

  private async lockKraken(message: string, status = 429): Promise<Response> {
    const retryAt = Date.now() + KRAKEN_LOCKOUT_MS;
    await this.ctx.storage.put(KRAKEN_LOCKOUT_UNTIL_KEY, retryAt);
    return Response.json(
      {
        configured: true,
        connected: false,
        safePermissions: null,
        temporaryLockout: true,
        retryAt: new Date(retryAt).toISOString(),
        retryAfterSeconds: Math.ceil(KRAKEN_LOCKOUT_MS / 1000),
        error: message,
        message: "No se enviarán más llamadas privadas a Kraken durante 15 minutos.",
        liveTrading: false,
      },
      { status },
    );
  }

  private async krakenConnection(): Promise<Response> {
    if (!this.env.KRAKEN_API_KEY || !this.env.KRAKEN_API_SECRET) {
      return Response.json(
        {
          configured: false,
          connected: false,
          safePermissions: null,
          message: "Faltan los secretos KRAKEN_API_KEY y KRAKEN_API_SECRET en Cloudflare.",
          liveTrading: false,
        },
        { status: 412 },
      );
    }

    const now = Date.now();
    const lockoutUntil = (await this.ctx.storage.get<number>(KRAKEN_LOCKOUT_UNTIL_KEY)) ?? 0;
    if (lockoutUntil > now) {
      return Response.json(
        {
          configured: true,
          connected: false,
          safePermissions: null,
          temporaryLockout: true,
          retryAt: new Date(lockoutUntil).toISOString(),
          retryAfterSeconds: Math.ceil((lockoutUntil - now) / 1000),
          message: "Comprobación bloqueada localmente para no prolongar el bloqueo temporal de Kraken.",
          liveTrading: false,
        },
        { status: 429 },
      );
    }

    try {
      const nonce = await this.nextKrakenNonce();
      const balances = await fetchBalance(this.env.KRAKEN_API_KEY, this.env.KRAKEN_API_SECRET, nonce);
      const eurRaw = balances.ZEUR ?? balances.EUR ?? "0";
      const eurParsed = Number(eurRaw);
      await this.ctx.storage.delete(KRAKEN_LOCKOUT_UNTIL_KEY);

      return Response.json({
        configured: true,
        connected: true,
        authenticationEndpoint: "Balance",
        safePermissions: null,
        permissionAudit: "completed-separately",
        eurBalance: Number.isFinite(eurParsed) ? eurParsed : null,
        nonZeroAssetCount: Object.values(balances).filter((value) => Number(value) > 0).length,
        liveTrading: false,
        message: "Autenticación válida. El trading real continúa bloqueado.",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Kraken connection failed";
      if (message.includes("EGeneral:Temporary lockout")) return this.lockKraken(message);

      const authenticationFailure = [
        "EAPI:Invalid key",
        "EAPI:Invalid signature",
        "EAPI:Invalid nonce",
      ].some((code) => message.includes(code));
      if (authenticationFailure) return this.lockKraken(message);

      return Response.json(
        {
          configured: true,
          connected: false,
          safePermissions: null,
          error: message,
          liveTrading: false,
        },
        { status: 502 },
      );
    }
  }

  private equity(snapshot: BotSnapshot, price: number): number {
    return money(snapshot.cashEur + (snapshot.position?.quantity ?? 0) * price);
  }

  private inCooldown(snapshot: BotSnapshot, now: number): boolean {
    if (snapshot.lastTradeAt === null) return false;
    return now - snapshot.lastTradeAt < snapshot.config.cooldownMinutes * 60_000;
  }

  private riskBlocked(snapshot: BotSnapshot): string | null {
    if (snapshot.dayStartEquityEur > 0) {
      const dailyLoss = (snapshot.dayStartEquityEur - snapshot.equityEur) / snapshot.dayStartEquityEur;
      if (dailyLoss >= snapshot.config.maxDailyLossPct) return "Límite de pérdida diaria alcanzado";
    }
    if (snapshot.peakEquityEur > 0) {
      const drawdown = (snapshot.peakEquityEur - snapshot.equityEur) / snapshot.peakEquityEur;
      if (drawdown >= snapshot.config.maxDrawdownPct) return "Límite de drawdown alcanzado";
    }
    return null;
  }

  private addTrade(snapshot: BotSnapshot, trade: PaperTrade): void {
    snapshot.performance.totalFeesEur = money(snapshot.performance.totalFeesEur + trade.feeEur);
    if (trade.side === "buy") {
      snapshot.performance.buyTrades += 1;
    } else {
      snapshot.performance.sellTrades += 1;
      if (typeof trade.pnlEur === "number") {
        snapshot.performance.closedTrades += 1;
        snapshot.performance.netPnlEur = money(snapshot.performance.netPnlEur + trade.pnlEur);
        if (trade.pnlEur > 0) {
          snapshot.performance.winningTrades += 1;
          snapshot.performance.grossProfitEur = money(
            snapshot.performance.grossProfitEur + trade.pnlEur,
          );
        } else if (trade.pnlEur < 0) {
          snapshot.performance.losingTrades += 1;
          snapshot.performance.grossLossEur = money(
            snapshot.performance.grossLossEur + Math.abs(trade.pnlEur),
          );
        }
      }
    }
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
    const observation = selectMarketObservation(candles, snapshot.lastClosedCandleTime);

    snapshot.ticksObserved += 1;
    snapshot.lastPrice = observation.currentPrice;
    snapshot.lastTickAt = now;
    snapshot.equityEur = this.equity(snapshot, observation.currentPrice);
    snapshot.peakEquityEur = Math.max(snapshot.peakEquityEur, snapshot.equityEur);
    this.updateObservedDrawdown(snapshot);

    if (!observation.isNewClosedCandle) {
      snapshot.duplicateCandleSkips += 1;
      snapshot.lastDecision = "Sin nueva vela cerrada de 15 minutos; señal no reevaluada";
      await this.write(snapshot);
      return snapshot;
    }

    snapshot.lastClosedCandleTime = observation.latestClosedCandleTime;
    snapshot.uniqueClosedCandlesObserved += 1;
    const indicators = calculateIndicators(
      observation.closedCandles,
      snapshot.config.fastPeriod,
      snapshot.config.slowPeriod,
      snapshot.config.rsiPeriod,
    );
    const decisionPrice = indicators.price;

    if (snapshot.position && decisionPrice <= snapshot.position.stopLoss) {
      this.sell(snapshot, decisionPrice, now, "Stop loss en vela cerrada");
    } else if (snapshot.position && decisionPrice >= snapshot.position.takeProfit) {
      this.sell(snapshot, decisionPrice, now, "Take profit en vela cerrada");
    } else {
      const riskBlock = this.riskBlocked(snapshot);
      if (riskBlock) {
        snapshot.lastDecision = riskBlock;
        snapshot.paused = true;
      } else if (this.inCooldown(snapshot, now)) {
        snapshot.lastDecision = "Cooldown de seguridad activo";
      } else {
        const signal = decide(indicators, snapshot.position !== null);
        if (signal.action === "buy") this.buy(snapshot, decisionPrice, now, signal.reason);
        else if (signal.action === "sell") this.sell(snapshot, decisionPrice, now, signal.reason);
        else snapshot.lastDecision = signal.reason;
      }
    }

    snapshot.equityEur = this.equity(snapshot, observation.currentPrice);
    snapshot.peakEquityEur = Math.max(snapshot.peakEquityEur, snapshot.equityEur);
    this.updateObservedDrawdown(snapshot);
    await this.write(snapshot);
    return snapshot;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/tick") {
        return Response.json(await this.tick());
      }
      if (request.method === "GET" && url.pathname === "/readiness") {
        return Response.json(calculatePaperReadiness(await this.read()));
      }
      if (request.method === "GET" && url.pathname === "/kraken/diagnostics") {
        return this.krakenDiagnostics();
      }
      if (request.method === "GET" && url.pathname === "/kraken/connection") {
        return this.krakenConnection();
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
      if (url.pathname === "/tick") snapshot.errorsObserved += 1;
      await this.write(snapshot);
      return Response.json({ error: message, snapshot }, { status: 500 });
    }
  }
}
