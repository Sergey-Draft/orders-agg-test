import { describe, expect, it } from "vitest";
import { apiOrder, dailyTotals, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

const day = (date: string, total: number) => ({ date, total, gross: total, discount: 0, net: total });

describe("GET /customers/:id/daily-totals", () => {
  it("суммирует оплаченные заказы по дням в таймзоне клиента", async () => {
    // c_1 — Europe/Moscow (UTC+3): 20:30Z ещё 10-е, 21:30Z уже 11-е
    await postWebhook(ctx.app, apiOrder({ amount: 1000, createdAt: "2026-02-10T20:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: 250, createdAt: "2026-02-10T21:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ amount: "99", createdAt: "2026-02-11T10:00:00Z" }));

    const res = await dailyTotals(ctx.app, "c_1", "2026-02-09", "2026-02-11");
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([day("2026-02-09", 0), day("2026-02-10", 1000), day("2026-02-11", 349)]);
  });

  it("не учитывает pending и refunded", async () => {
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 700, status: "pending" }));
    await postWebhook(ctx.app, apiOrder({ amount: 900, status: "refunded" }));
    const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([day("2026-02-10", 500)]);
  });

  it("учитывает только заказы этого клиента", async () => {
    ctx.api.customers.set("c_2", "Asia/Novosibirsk");
    await postWebhook(ctx.app, apiOrder({ amount: 500 }));
    await postWebhook(ctx.app, apiOrder({ amount: 800, customerId: "c_2" }));
    const res = await dailyTotals(ctx.app, "c_2", "2026-02-10", "2026-02-10");
    expect(res.json()).toEqual([day("2026-02-10", 800)]);
  });

  it("таймзона клиента берётся из API один раз", async () => {
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    ctx.api.customers.set("c_1", "UTC");
    await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
    const { rows } = await ctx.db.query(`SELECT timezone FROM customers WHERE id = 'c_1'`);
    expect(rows[0].timezone).toBe("Europe/Moscow");
  });

  it("валидирует даты", async () => {
    expect((await dailyTotals(ctx.app, "c_1", "2026-02-30", "2026-03-01")).statusCode).toBe(400);
    expect((await dailyTotals(ctx.app, "c_1", "2026-03-02", "2026-03-01")).statusCode).toBe(400);
  });

  it("неизвестный клиент — 404", async () => {
    const res = await dailyTotals(ctx.app, "nobody", "2026-02-10", "2026-02-10");
    expect(res.statusCode).toBe(404);
  });

  it("учитывает переход на летнее время внутри периода", async () => {
    ctx.api.customers.set("c_b", "Europe/Berlin");
    await postWebhook(ctx.app, apiOrder({ customerId: "c_b", amount: 100, createdAt: "2026-03-27T23:30:00Z" }));
    await postWebhook(ctx.app, apiOrder({ customerId: "c_b", amount: 200, createdAt: "2026-03-29T22:30:00Z" }));

    const res = await dailyTotals(ctx.app, "c_b", "2026-03-27", "2026-03-30");
    expect(res.json()).toEqual([day("2026-03-27", 0), day("2026-03-28", 100), day("2026-03-29", 0), day("2026-03-30", 200)]);
  });

  describe("скидки", () => {
    it("gross, discount и net по дням; total = gross", async () => {
      await postWebhook(ctx.app, apiOrder({ amount: 2500, discountPercent: 16.5, amountPaid: 2087.5 }));
      await postWebhook(ctx.app, apiOrder({ amount: "3138", discountPercent: "13", amountPaid: 2730.06 }));
      await postWebhook(ctx.app, apiOrder({ amount: "1954.00", discountPercent: 13, amountPaid: "1699.98" }));
      await postWebhook(ctx.app, apiOrder({ amount: 300 }));
      await postWebhook(ctx.app, apiOrder({ amount: 700, discountPercent: 0, amountPaid: 700 }));

      const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
      expect(res.json()).toEqual([{ date: "2026-02-10", total: 8592, gross: 8592, discount: 1074.46, net: 7517.54 }]);
    });

    it("считает в копейках без накопления ошибки float", async () => {
      for (let i = 0; i < 10; i++) {
        await postWebhook(ctx.app, apiOrder({ amount: 0.3, discountPercent: 33, amountPaid: 0.2 }));
      }
      const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
      expect(res.json()).toEqual([{ date: "2026-02-10", total: 3, gross: 3, discount: 1, net: 2 }]);
    });

    it("учитывает только оплаченные", async () => {
      await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900 }));
      await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900, status: "pending" }));
      await postWebhook(ctx.app, apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900, status: "refunded" }));
      const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
      expect(res.json()).toEqual([{ date: "2026-02-10", total: 1000, gross: 1000, discount: 100, net: 900 }]);
    });

    it("берёт скидку из самой свежей версии заказа", async () => {
      const o = apiOrder({ amount: 1000, discountPercent: 10, amountPaid: 900 });
      await postWebhook(ctx.app, o);
      await postWebhook(ctx.app, { ...o, discountPercent: 33, amountPaid: 670, updatedAt: "2026-02-10T13:00:00Z" });
      await postWebhook(ctx.app, { ...o, discountPercent: 20, amountPaid: 800, updatedAt: "2026-02-10T12:30:00Z" });
      const res = await dailyTotals(ctx.app, "c_1", "2026-02-10", "2026-02-10");
      expect(res.json()).toEqual([{ date: "2026-02-10", total: 1000, gross: 1000, discount: 330, net: 670 }]);
    });
  });
});
