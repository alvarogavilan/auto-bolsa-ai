import { describe, expect, it } from "vitest";
import { FakeLiveOrderTransport } from "../src/live-transport";

function request(clOrdId: string, overrides: Partial<{ volumeBase: string; limitPrice: string }> = {}) {
  return {
    clOrdId,
    pair: "XBTEUR",
    side: "buy" as const,
    volumeBase: "0.0001",
    limitPrice: "50000",
    ...overrides,
  };
}

describe("FakeLiveOrderTransport", () => {
  it("never sends two orders to the simulated exchange for the same cl_ord_id", async () => {
    const transport = new FakeLiveOrderTransport();
    const first = await transport.createOrder(request("dup-1"));
    const second = await transport.createOrder(request("dup-1"));
    expect(first.kind).toBe("accepted");
    expect(second.kind).toBe("accepted");
    expect(second.exchangeOrderId).toBe(first.exchangeOrderId);
    const open = await transport.listOpenOrders();
    const closed = await transport.listClosedOrders();
    expect(open.length + closed.length).toBe(1);
  });

  it("throws to simulate a gateway timeout", async () => {
    const transport = new FakeLiveOrderTransport();
    transport.scriptScenario("timeout-1", { kind: "timeout" });
    await expect(transport.createOrder(request("timeout-1"))).rejects.toThrow(/Timeout/);
  });

  it("allows a retry after a timeout to succeed, mirroring a real flaky gateway", async () => {
    const transport = new FakeLiveOrderTransport();
    transport.scriptScenario("timeout-2", { kind: "timeout" });
    await expect(transport.createOrder(request("timeout-2"))).rejects.toThrow();
    const retry = await transport.createOrder(request("timeout-2"));
    expect(retry.kind).toBe("accepted");
    expect(retry.exchangeOrderId).not.toBeNull();
  });

  it("reports an explicit rejection without creating an order", async () => {
    const transport = new FakeLiveOrderTransport();
    transport.scriptScenario("reject-1", { kind: "reject", reason: "Insufficient funds" });
    const ack = await transport.createOrder(request("reject-1"));
    expect(ack.kind).toBe("rejected");
    expect(ack.exchangeOrderId).toBeNull();
  });

  it("surfaces a malformed/unknown response distinctly from accept or reject", async () => {
    const transport = new FakeLiveOrderTransport();
    transport.scriptScenario("unknown-1", { kind: "unknown" });
    const ack = await transport.createOrder(request("unknown-1"));
    expect(ack.kind).toBe("unknown");
    expect(ack.exchangeOrderId).toBeNull();
  });

  it("models a partial fill that later completes", async () => {
    const transport = new FakeLiveOrderTransport();
    transport.scriptScenario("partial-1", { kind: "partial-then-fill", firstFillFraction: 0.4 });
    const ack = await transport.createOrder(request("partial-1", { volumeBase: "1" }));
    expect(ack.exchangeOrderId).not.toBeNull();
    const exchangeOrderId = ack.exchangeOrderId!;

    const openBeforeFill = await transport.queryOrder(exchangeOrderId);
    expect(openBeforeFill?.status).toBe("open");
    expect(openBeforeFill?.volumeExecutedBase).toBeCloseTo(0.4);

    transport.completeFill(exchangeOrderId);
    const afterFill = await transport.queryOrder(exchangeOrderId);
    expect(afterFill?.status).toBe("closed");
    expect(afterFill?.volumeExecutedBase).toBeCloseTo(1);
  });

  it("cancels an open order but refuses to cancel one already closed", async () => {
    const transport = new FakeLiveOrderTransport();
    transport.scriptScenario("cancel-1", { kind: "accept-open" });
    const ack = await transport.createOrder(request("cancel-1"));
    const exchangeOrderId = ack.exchangeOrderId!;
    const cancelled = await transport.cancelOrder(exchangeOrderId);
    expect(cancelled.cancelled).toBe(true);

    const alreadyClosed = await transport.createOrder(request("cancel-2"));
    const secondCancel = await transport.cancelOrder(alreadyClosed.exchangeOrderId!);
    expect(secondCancel.cancelled).toBe(false);
  });

  it("registers the order remotely even when the client only observes a timeout afterwards", async () => {
    const transport = new FakeLiveOrderTransport();
    transport.scriptScenario("phantom-1", { kind: "accept-but-report-timeout" });
    await expect(transport.createOrder(request("phantom-1"))).rejects.toThrow(/Timeout/);

    const found = await transport.findByClOrdId("phantom-1");
    expect(found).not.toBeNull();
    expect(found?.clOrdId).toBe("phantom-1");

    const open = await transport.listOpenOrders();
    const closed = await transport.listClosedOrders();
    expect(open.length + closed.length).toBe(1);
  });

  it("findByClOrdId returns null for an order the exchange never received", async () => {
    const transport = new FakeLiveOrderTransport();
    expect(await transport.findByClOrdId("never-sent")).toBeNull();
  });

  it("reports a settable simulated balance instead of an always-empty placeholder", async () => {
    const transport = new FakeLiveOrderTransport();
    expect(await transport.fetchBalances()).toEqual({ ZEUR: "0" });
    transport.setBalance("XXBT", "1.5");
    expect(await transport.fetchBalances()).toEqual({ ZEUR: "0", XXBT: "1.5" });
  });
});
