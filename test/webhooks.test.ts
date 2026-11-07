import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });

  it("невалидная скидка — 400", async () => {
    const cases = [
      { amount: 1000, discountPercent: 10 },
      { amount: 1000, discountPercent: 10, amountPaid: 1000.01 },
      { amount: 1000, discountPercent: 150, amountPaid: 0 },
      { amount: 1000, discountPercent: "", amountPaid: 1000 },
      { amount: 1000, discountPercent: 10, amountPaid: "abc" },
    ];
    for (const over of cases) {
      const res = await postWebhook(ctx.app, apiOrder(over));
      expect(res.statusCode, JSON.stringify(over)).toBe(400);
    }
  });

  it("одновременные события: остаётся самая свежая версия", async () => {
    const versions = ["2026-02-10T13:00:00Z", "2026-02-10T14:00:00Z", "2026-02-10T15:00:00Z"];
    const orders = Array.from({ length: 20 }, () => apiOrder({ status: "pending" }));
    await Promise.all(orders.map((o) => postWebhook(ctx.app, o)));

    await Promise.all(
      orders.flatMap((o) =>
        [...versions].reverse().map((updatedAt, i) => postWebhook(ctx.app, { ...o, status: i === 0 ? "refunded" : "paid", updatedAt })),
      ),
    );

    const { rows } = await ctx.db.query(`SELECT status, updated_at FROM orders WHERE id = ANY($1)`, [orders.map((o) => o.id)]);
    expect(rows).toHaveLength(orders.length);
    for (const r of rows) {
      expect(r.status).toBe("refunded");
      expect(r.updated_at.toISOString()).toBe("2026-02-10T15:00:00.000Z");
    }
  });
});
