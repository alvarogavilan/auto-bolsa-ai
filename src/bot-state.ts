import { DurableObject } from "cloudflare:workers";
import {
  createDailyCheckpoint,
  verifyCheckpointChain,
  type PaperDailyCheckpoint,
} from "./daily-checkpoints";
import { fetchBalance, fetchOhlc, inspectKrakenCredentials } from "./kraken";
import { computeNextNonce } from "./kraken-nonce";
import { selectMarketObservation } from "./market-evidence";
import { calculateOperationalHealth } from "./operational-health";
import { calculatePaperReadiness } from "./paper-readiness";
import {
  appendSignalEvidence,
  emptySignalEvidenceLedger,
  summarizeSignalEvidence,
  type SignalEvidenceEntry,
  type SignalEvidenceLedger,
  type SignalOutcome,
} from "./signal-evidence";
import { calculateIndicators, decide } from "./strategy";
import type { BotConfig, BotSnapshot, Env, PaperPerformance, PaperTrade } from "./types";

const STORAGE_KEY = "snapshot";
const DAILY_CHECKPOINTS_KEY = "paper-daily-checkpoints";
const SIGNAL_EVIDENCE_KEY = "paper-signal-evidence";
const MAX_DAILY_CHECKPOINTS = 180;
const KRAKEN_NONCE_KEY = "kraken-last-nonce";
const KRAKEN_LOCKOUT_UNTIL_KEY = "kraken-lockout-until";
const KRAKEN_LOCKOUT_MS = 15 * 60_000;
const VERSION = "0.13.0-paper";

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
    consecutiveErrors: 0,
    lastError: null,
    maxObservedDrawdownPct: 0,
    lastClosedCandleTime: null,
    lastPrice: null,
    lastTickAt: null,
    lastSuccessfulTickAt: null,
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
      consecutiveErrors: stored.consecutiveErrors ?? 0,
      lastError: stored.lastError ?? null,
      maxObservedDrawdownPct: stored.maxObservedDrawdownPct ?? 0,
      lastClosedCandleTime: stored.lastClosedCandleTime ?? null,
      lastSuccessfulTickAt: stored.lastSuccessfulTickAt ?? stored.lastTickAt ?? null,
      config: { ...fallback.config, ...(stored.config ?? {}) },
      performance: stored.performance ?? derivePerformance(trades),
      trades,
    };
  }

  private async write(snapshot: BotSnapshot): Promise<void> {
    await this.ctx.storage.put(STORAGE_KEY, snapshot);
  }

  private async readDailyCheckpoints(): Promise<PaperDailyCheckpoint[]> {
    const stored = await this.ctx.storage.get<PaperDailyCheckpoint[]>(DAILY_CHECKPOINTS_KEY);
    return Array.isArray(stored) ? stored : [];
  }

  private async recordDailyCheckpoint(snapshot: BotSnapshot, recordedAt: number): Promise<void> {
    const checkpoints = await this.readDailyCheckpoints();
    const previous = checkpoints.at(-1) ?? null;
    if (previous?.dayKey === snapshot.dayKey) return;

    const checkpoint = await createDailyCheckpoint(snapshot, previous, recordedAt);
    await this.ctx.storage.put(
      DAILY_CHECKPOINTS_KEY,
      [...checkpoints, checkpoint].slice(-MAX_DAILY_CHECKPOINTS),
    );
  }

  private dailyCheckpointSummary(checkpoints: PaperDailyCheckpoint[]): Record<string, unknown> {
    const latest = checkpoints.at(-1) ?? null;
    return {
      schemaVersion: "paper-daily-checkpoint-v1",
      checkpointCount: checkpoints.length,
      latestDayKey: latest?.dayKey ?? null,
      latestSequence: latest?.sequence ?? null,
      latestHashPrefix: latest?.hash.slice(0, 16) ?? null,
      retentionDays: MAX_DAILY_CHECKPOINTS,
      liveTrading: false,
      message: checkpoints.length > 0
        ? "La evidencia diaria PAPER se conserva en una cadena criptográfica."
        : "El primer cierre diario se registrará automáticamente al cambiar el día UTC.",
    };
  }

  private async readSignalEvidence(): Promise<SignalEvidenceLedger> {
    const stored = await this.ctx.storage.get<SignalEvidenceLedger>(SIGNAL_EVIDENCE_KEY);
    if (!stored || stored.schemaVersion !== "paper-signal-ledger-v1") {
      return emptySignalEvidenceLedger();
    }

    const fallback = emptySignalEvidenceLedger();
    return {
      ...fallback,
      ...stored,
      stats: { ...fallback.stats, ...stored.stats },
      entries: Array.isArray(stored.entries) ? stored.entries : [],
    };
  }

  private async recordSignalEvidence(entry: SignalEvidenceEntry): Promise<void> {
    const ledger = await this.readSignalEvidence();
    await this.ctx.storage.put(SIGNAL_EVIDENCE_KEY, appendSignalEvidence(ledger, entry));
  }

  private markSuccessfulCycle(snapshot: BotSnapshot, now: number): void {
    snapshot.lastSuccessfulTickAt = now;
    snapshot.consecutiveErrors = 0;
    snapshot.lastError = null;
  }

  private updateObservedDrawdown(snapshot: BotSnapshot): void {
    if (snapshot.peakEquityEur <= 0) return;
    const current = Math.max(0, (snapshot.peakEquityEur - snapshot.equityEur) / snapshot.peakEquityEur);
    snapshot.maxObservedDrawdownPct = Math.max(snapshot.maxObservedDrawdownPct, current);
  }

  /**
   * Única autoridad persistente del nonce de Kraken para esta clave de API.
   * Cualquier código del Worker que necesite firmar una llamada privada
   * (incluido el ejecutor LIVE, ver `LiveExecutorState`) debe pedir el nonce
   * aquí en vez de mantener su propio contador: dos contadores independientes
   * podrían emitir nonces desordenados y bloquear la clave en Kraken.
   */
  private async nextKrakenNonce(): Promise<string> {
    const stored = await this.ctx.storage.get<string>(KRAKEN_NONCE_KEY);
    const last = stored ? BigInt(stored) : 0n;
    const next = computeNextNonce(last, Date.now());
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
      await this.recordDailyCheckpoint(snapshot, now);
      snapshot.dayKey = utcDay(now);
      snapshot.dayStartEquityEur = snapshot.equityEur;
    }

    if (snapshot.paused) {
      snapshot.lastTickAt = now;
      this.markSuccessfulCycle(snapshot, now);
      snapshot.lastDecision = "Pausado por el usuario";
      await this.write(snapshot);
      return snapshot;
    }

    const candles = await fetchOhlc(snapshot.config.pair, 15);
    const observation = selectMarketObservation(candles, snapshot.lastClosedCandleTime);

    snapshot.ticksObserved += 1;
    snapshot.lastPrice = observation.currentPrice;
    snapshot.lastTickAt = now;
    this.markSuccessfulCycle(snapshot, now);
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
    const hadPositionBefore = snapshot.position !== null;
    const rawSignal = decide(indicators, hadPositionBefore);
    let outcome: SignalOutcome = "hold";
    let finalReason = rawSignal.reason;

    if (snapshot.position && decisionPrice <= snapshot.position.stopLoss) {
      finalReason = "Stop loss en vela cerrada";
      this.sell(snapshot, decisionPrice, now, finalReason);
      outcome = "stop-loss-executed";
    } else if (snapshot.position && decisionPrice >= snapshot.position.takeProfit) {
      finalReason = "Take profit en vela cerrada";
      this.sell(snapshot, decisionPrice, now, finalReason);
      outcome = "take-profit-executed";
    } else {
      const riskBlock = this.riskBlocked(snapshot);
      if (riskBlock) {
        snapshot.lastDecision = riskBlock;
        snapshot.paused = true;
        finalReason = riskBlock;
        outcome = "risk-blocked";
      } else if (this.inCooldown(snapshot, now)) {
        snapshot.lastDecision = "Cooldown de seguridad activo";
        finalReason = snapshot.lastDecision;
        outcome = "cooldown-blocked";
      } else if (rawSignal.action === "buy") {
        const before = snapshot.performance.buyTrades;
        this.buy(snapshot, decisionPrice, now, rawSignal.reason);
        finalReason = snapshot.lastDecision;
        outcome = snapshot.performance.buyTrades > before ? "buy-executed" : "execution-blocked";
      } else if (rawSignal.action === "sell") {
        const before = snapshot.performance.sellTrades;
        this.sell(snapshot, decisionPrice, now, rawSignal.reason);
        finalReason = snapshot.lastDecision;
        outcome = snapshot.performance.sellTrades > before ? "sell-executed" : "execution-blocked";
      } else {
        snapshot.lastDecision = rawSignal.reason;
        finalReason = rawSignal.reason;
        outcome = "hold";
      }
    }

    snapshot.equityEur = this.equity(snapshot, observation.currentPrice);
    snapshot.peakEquityEur = Math.max(snapshot.peakEquityEur, snapshot.equityEur);
    this.updateObservedDrawdown(snapshot);

    await this.recordSignalEvidence({
      schemaVersion: "paper-signal-evidence-v1",
      candleTime: observation.latestClosedCandleTime,
      recordedAt: now,
      price: decisionPrice,
      fastEma: indicators.fastEma,
      slowEma: indicators.slowEma,
      previousFastEma: indicators.previousFastEma,
      previousSlowEma: indicators.previousSlowEma,
      rsi: indicators.rsi,
      rawSignal: rawSignal.action,
      rawReason: rawSignal.reason,
      outcome,
      finalReason,
      hadPositionBefore,
      hasPositionAfter: snapshot.position !== null,
      equityEur: snapshot.equityEur,
      cashEur: snapshot.cashEur,
    });

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
      if (request.method === "GET" && url.pathname === "/checkpoints") {
        const checkpoints = await this.readDailyCheckpoints();
        return Response.json({
          checkpoints,
          verification: await verifyCheckpointChain(checkpoints),
          retentionDays: MAX_DAILY_CHECKPOINTS,
          liveTrading: false,
        });
      }
      if (request.method === "GET" && url.pathname === "/signals") {
        const ledger = await this.readSignalEvidence();
        return Response.json({
          ...ledger,
          summary: summarizeSignalEvidence(ledger),
          liveTrading: false,
        });
      }
      if (request.method === "POST" && url.pathname === "/kraken/next-nonce") {
        return Response.json({ nonce: await this.nextKrakenNonce() });
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
        const [snapshot, checkpoints, signalLedger] = await Promise.all([
          this.read(),
          this.readDailyCheckpoints(),
          this.readSignalEvidence(),
        ]);
        return Response.json({
          ...snapshot,
          operationalHealth: calculateOperationalHealth(snapshot),
          dailyCheckpointSummary: this.dailyCheckpointSummary(checkpoints),
          signalEvidenceSummary: summarizeSignalEvidence(signalLedger),
        });
      }
      return new Response("Not found", { status: 404 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown bot error";
      const snapshot = await this.read();
      snapshot.lastTickAt = Date.now();
      snapshot.lastDecision = `ERROR: ${message}`;
      if (url.pathname === "/tick") {
        snapshot.errorsObserved += 1;
        snapshot.consecutiveErrors += 1;
        snapshot.lastError = message;
      }
      await this.write(snapshot);
      return Response.json({
        error: message,
        snapshot,
        operationalHealth: calculateOperationalHealth(snapshot),
      }, { status: 500 });
    }
  }
}
