import { createXauPaperCycleLedger, type XauPaperCycleLedger } from "./xau-usd-cycle-ledger";
import { runPersistentXauPaperCycle, XAU_PAPER_LEDGER_KEY, type XauPaperStateStore } from "./xau-usd-persistent-orchestrator";
import type { XauPaperRuntimeInput } from "./xau-usd-paper-runtime";

export class XauPaperState {
  constructor(private readonly state: DurableObjectState) {}

  private store(): XauPaperStateStore {
    return {
      get: async (key) => (await this.state.storage.get<string>(key)) ?? null,
      put: async (key, value) => { await this.state.storage.put(key, value); },
    };
  }

  private async ledger(): Promise<XauPaperCycleLedger> {
    const raw = await this.state.storage.get<string>(XAU_PAPER_LEDGER_KEY);
    if (!raw) return createXauPaperCycleLedger();
    try { return JSON.parse(raw) as XauPaperCycleLedger; }
    catch { return createXauPaperCycleLedger(); }
  }

  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (request.method === "GET" && path === "/status") {
      return Response.json({ ...(await this.ledger()), mode: "paper", liveTrading: false, realOrderSubmission: false }, { headers: { "Cache-Control": "no-store" } });
    }
    if (request.method === "POST" && path === "/cycle") {
      const input = await request.json<XauPaperRuntimeInput>();
      const result = await runPersistentXauPaperCycle(this.store(), input);
      return Response.json(result, { status: result.instruction.allowed ? 200 : 202, headers: { "Cache-Control": "no-store" } });
    }
    return new Response("Not found", { status: 404 });
  }
}
