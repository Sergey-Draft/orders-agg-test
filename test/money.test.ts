import { describe, expect, it } from "vitest";
import { fromKop, parsePercent, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
  });
});

describe("parsePercent", () => {
  it("принимает число и строку с числом от 0 до 100", () => {
    expect(parsePercent(0)).toBe(0);
    expect(parsePercent("13")).toBe(13);
    expect(parsePercent(16.5)).toBe(16.5);
    expect(parsePercent(100)).toBe(100);
  });

  it("отклоняет мусор и значения вне диапазона", () => {
    expect(() => parsePercent("")).toThrow();
    expect(() => parsePercent("abc")).toThrow();
    expect(() => parsePercent(-1)).toThrow();
    expect(() => parsePercent(101)).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it("не теряет копейку на неточных в float суммах", () => {
    expect(toKop(19.99)).toBe(1999);
    expect(toKop(0.29)).toBe(29);
    expect(toKop(4.35)).toBe(435);
    expect(toKop(1.15)).toBe(115);
    expect(toKop(8.2)).toBe(820);
    expect(toKop(parseRub("19.99"))).toBe(1999);
    expect(toKop(0)).toBe(0);
    expect(toKop(2087.5)).toBe(208750);
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});
