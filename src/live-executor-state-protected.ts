import { LiveExecutorState as BaseLiveExecutorState } from "./live-executor-state";
import { liveTradingEnabledFromEnv } from "./live-guardrails";
import {
  reconcileKrakenGoldProtection,
  releaseKrakenGoldProtectionForExit,
} from "./kraken-gold-protection-lifecycle";
import { BOT_STATE_SINGLETON_NAME, type Env } from "./types";

const APPROVAL_STORAGE_KEY = "live-human-trade-approval-v1";
const APPROVAL_TTL_MS = 2 * 60_000;

interface HumanTradeApproval {
  schemaVersion: "live-human-trade-approval-v1";
  clOrdId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  approvedAt: number | null;
  consumedAt: number | null;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

async function sha256(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export class LiveExecutorState extends BaseLiveExecutorState {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private async nextSharedNonce(): Promise<string> {
    const bot = this.env.BOT_STATE.get(this.env.BOT_STATE.idFromName(BOT_STATE_SINGLETON_NAME));
    const response = await bot.fetch("https://bot/kraken/next-nonce", { method: "POST" });
    if (!response.ok) throw new Error(`Nonce authority HTTP ${response.status}`);
    const body = object(await response.json());
    if (typeof body.nonce !== "string" || !body.nonce) throw new Error("Nonce authority returned no nonce");
    return body.nonce;
  }

  private protectionContext(state: Record<string, unknown>) {
    return {
      state: state as never,
      configuredPair: this.env.PAIR || "PAXGEUR",
      apiKey: this.env.KRAKEN_API_KEY!,
      apiSecret: this.env.KRAKEN_API_SECRET!,
      nextNonce: () => this.nextSharedNonce(),
      storage: this.ctx.storage,
    };
  }

  private async readApproval(): Promise<HumanTradeApproval | null> {
    const value = await this.ctx.storage.get<HumanTradeApproval>(APPROVAL_STORAGE_KEY);
    return value?.schemaVersion === "live-human-trade-approval-v1" ? value : null;
  }

  private async inspectApprovalToken(token: string, now: number): Promise<{ approval: HumanTradeApproval; order: Record<string, unknown> } | null> {
    if (!token.trim()) return null;
    const approval = await this.readApproval();
    if (!approval || approval.expiresAt <= now || approval.consumedAt !== null) return null;
    if (approval.tokenHash !== await sha256(token)) return null;
    const base = await super.fetch(new Request("https://live/status"));
    const state = object(await base.json());
    const orders = object(state.orders);
    const order = object(orders[approval.clOrdId]);
    if (!Object.keys(order).length || order.status !== "prepared") return null;
    return { approval, order };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const live = liveTradingEnabledFromEnv(this.env.LIVE_TRADING_ENABLED);
    const now = Date.now();

    if (request.method === "POST" && url.pathname === "/approval/create") {
      const body = object(await request.json().catch(() => ({})));
      const clOrdId = typeof body.clOrdId === "string" ? body.clOrdId.trim() : "";
      if (!clOrdId) return Response.json({ ok: false, error: "MISSING_CL_ORD_ID" }, { status: 400 });

      const details = await super.fetch(new Request("https://live/readiness-details"));
      const readiness = object(await details.json());
      const order = object(readiness.order);
      const certificate = object(readiness.preflightCertificate);
      if (order.clOrdId !== clOrdId || order.status !== "prepared") {
        return Response.json({ ok: false, error: "ORDER_NOT_PREPARED" }, { status: 409 });
      }
      if (certificate.status !== "valid" || certificate.realOrderCreated !== false || certificate.validateFlagForced !== true) {
        return Response.json({ ok: false, error: "PREFLIGHT_CERTIFICATE_NOT_VALID" }, { status: 409 });
      }

      const existing = await this.readApproval();
      if (existing && existing.clOrdId === clOrdId && existing.expiresAt > now && existing.consumedAt === null) {
        return Response.json({ ok: false, error: "APPROVAL_ALREADY_PENDING", expiresAt: existing.expiresAt }, { status: 409 });
      }

      const token = `${crypto.randomUUID()}${crypto.randomUUID().replaceAll("-", "")}`;
      const approval: HumanTradeApproval = {
        schemaVersion: "live-human-trade-approval-v1",
        clOrdId,
        tokenHash: await sha256(token),
        createdAt: now,
        expiresAt: now + APPROVAL_TTL_MS,
        approvedAt: null,
        consumedAt: null,
      };
      await this.ctx.storage.put(APPROVAL_STORAGE_KEY, approval);
      return Response.json({ ok: true, clOrdId, token, createdAt: approval.createdAt, expiresAt: approval.expiresAt });
    }

    if (request.method === "GET" && url.pathname === "/approval/inspect") {
      const token = url.searchParams.get("token") ?? "";
      const match = await this.inspectApprovalToken(token, now);
      if (!match) return Response.json({ ok: false, error: "APPROVAL_INVALID_OR_EXPIRED" }, { status: 404 });
      const requestData = object(match.order.request);
      return Response.json({
        ok: true,
        clOrdId: match.approval.clOrdId,
        createdAt: match.approval.createdAt,
        expiresAt: match.approval.expiresAt,
        approvedAt: match.approval.approvedAt,
        order: {
          pair: requestData.pair,
          side: requestData.side,
          volumeBase: requestData.volumeBase,
          limitPrice: requestData.limitPrice,
          notionalEur: requestData.notionalEur,
        },
      });
    }

    if (request.method === "POST" && url.pathname === "/approval/authorize") {
      const body = object(await request.json().catch(() => ({})));
      const token = typeof body.token === "string" ? body.token : "";
      const match = await this.inspectApprovalToken(token, now);
      if (!match) return Response.json({ ok: false, error: "APPROVAL_INVALID_OR_EXPIRED" }, { status: 409 });
      if (match.approval.approvedAt === null) {
        match.approval.approvedAt = now;
        await this.ctx.storage.put(APPROVAL_STORAGE_KEY, match.approval);
      }
      return Response.json({ ok: true, clOrdId: match.approval.clOrdId, approvedAt: match.approval.approvedAt, expiresAt: match.approval.expiresAt });
    }

    if (request.method === "POST" && url.pathname === "/approval/reject") {
      const body = object(await request.json().catch(() => ({})));
      const token = typeof body.token === "string" ? body.token : "";
      const match = await this.inspectApprovalToken(token, now);
      if (!match) return Response.json({ ok: false, error: "APPROVAL_INVALID_OR_EXPIRED" }, { status: 409 });

      match.approval.consumedAt = now;
      await this.ctx.storage.put(APPROVAL_STORAGE_KEY, match.approval);

      const cancelled = await super.fetch(new Request("https://live/emergency-cancel-all", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Orden preparada rechazada por autorización humana" }),
      }));
      if (!cancelled.ok) {
        return Response.json({ ok: false, error: "PREPARED_ORDER_REJECTION_FAILED", clOrdId: match.approval.clOrdId }, { status: 409 });
      }

      await super.fetch(new Request("https://live/clear-emergency-stop", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Rechazo humano completado sin envío a Kraken" }),
      }));

      return Response.json({
        ok: true,
        rejected: true,
        clOrdId: match.approval.clOrdId,
        rejectedAt: now,
        realOrderCreated: false,
      });
    }

    if (request.method === "POST" && url.pathname === "/submit") {
      const body = object(await request.clone().json().catch(() => ({})));
      const clOrdId = typeof body.clOrdId === "string" ? body.clOrdId : "";
      const approval = await this.readApproval();
      const allowed = approval
        && approval.clOrdId === clOrdId
        && approval.approvedAt !== null
        && approval.consumedAt === null
        && approval.expiresAt > now;
      if (!allowed) {
        return Response.json({
          ok: false,
          blockers: ["La orden real exige una autorización humana vigente y de un solo uso"],
          approvalRequired: true,
        }, { status: 409 });
      }
      approval.consumedAt = now;
      await this.ctx.storage.put(APPROVAL_STORAGE_KEY, approval);
    }

    if (request.method === "POST" && url.pathname === "/protection/release-for-exit") {
      if (!live || !this.env.KRAKEN_API_KEY || !this.env.KRAKEN_API_SECRET) {
        return Response.json({
          ok: false,
          released: false,
          blocker: "LIVE no está armado o faltan credenciales Kraken",
          liveTrading: false,
        }, { status: 409 });
      }
      const base = await super.fetch(new Request("https://live/status"));
      const state = object(await base.json());
      const result = await releaseKrakenGoldProtectionForExit(this.protectionContext(state));
      return Response.json(result, { status: result.ok ? 200 : 409 });
    }

    const response = await super.fetch(request);
    if (!live || !this.env.KRAKEN_API_KEY || !this.env.KRAKEN_API_SECRET) return response;
    if (request.method !== "POST" || (url.pathname !== "/reconcile" && url.pathname !== "/retry")) return response;

    const body = object(await response.clone().json().catch(() => ({})));
    const verified = object(body.verifiedReconciliation);
    const state = object(body.state);
    if (verified.ok !== true || Object.keys(state).length === 0) return response;

    try {
      const protection = await reconcileKrakenGoldProtection(this.protectionContext(state));
      if ("ok" in protection && protection.ok === false) {
        return Response.json({
          ...body,
          protection,
          failClosed: true,
          error: "GOLD_PROTECTION_NOT_VERIFIED",
        }, { status: 409 });
      }
      return Response.json({ ...body, protection }, { status: response.status });
    } catch (error) {
      return Response.json({
        ...body,
        failClosed: true,
        error: "GOLD_PROTECTION_RECONCILIATION_FAILED",
        message: error instanceof Error ? error.message : "Gold protection failed",
      }, { status: 409 });
    }
  }
}
