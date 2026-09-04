import { describe, expect, it } from "vitest";
import {
  contractView,
  costEntry,
  marginMoney,
  marginTotals,
  type GroupRow,
} from "./margin";

function row(over: Partial<GroupRow> = {}): GroupRow {
  return {
    hours: "1.00",
    billable: true,
    costAmount: "10.00",
    revenueAmount: "50.00",
    currency: "USD",
    ...over,
  };
}

describe("costEntry", () => {
  it("costs an hour at the resolved rate", () => {
    expect(
      costEntry({
        hours: "2.50",
        billable: true,
        internalCostPerHour: "12.50",
        billableRatePerHour: "50.00",
      }),
    ).toEqual({ costAmount: "31.25", revenueAmount: "125.00" });
  });

  it("costs non-billable hours and earns nothing on them", () => {
    // The whole point: a two-hour internal meeting costs money and earns none.
    expect(
      costEntry({
        hours: "2.00",
        billable: false,
        internalCostPerHour: "12.50",
        billableRatePerHour: "50.00",
      }),
    ).toEqual({ costAmount: "25.00", revenueAmount: "0.00" });
  });

  it("distinguishes 'no rate card' from 'earns nothing'", () => {
    const noCard = costEntry({
      hours: "2.00",
      billable: true,
      internalCostPerHour: "12.50",
      billableRatePerHour: null,
    });
    expect(noCard.revenueAmount).toBeNull();

    const nonBillable = costEntry({
      hours: "2.00",
      billable: false,
      internalCostPerHour: "12.50",
      billableRatePerHour: "50.00",
    });
    expect(nonBillable.revenueAmount).toBe("0.00");
  });

  it("rounds to the cent, per entry", () => {
    const e = costEntry({
      hours: "0.33",
      billable: true,
      internalCostPerHour: "33.33",
      billableRatePerHour: null,
    });
    expect(e.costAmount).toBe("11.00");
  });
});

describe("marginTotals identities", () => {
  const rows = [
    row({ hours: "3.00", billable: true }),
    row({ hours: "1.50", billable: false }),
    row({ hours: "2.25", billable: true, costAmount: null, revenueAmount: null }),
  ];

  it("billable + non-billable = logged", () => {
    const t = marginTotals(rows);
    expect(Number(t.billableHours) + Number(t.nonBillableHours)).toBeCloseTo(
      Number(t.loggedHours),
      2,
    );
    expect(t.loggedHours).toBe("6.75");
  });

  it("costed + uncosted = logged", () => {
    const t = marginTotals(rows);
    expect(Number(t.costedHours) + Number(t.uncostedHours)).toBeCloseTo(
      Number(t.loggedHours),
      2,
    );
    expect(t.uncostedHours).toBe("2.25");
  });

  it("does not drift on a long column of small entries", () => {
    // The float-addition case grid-totals.test.ts also pins.
    const many = Array.from({ length: 300 }, () => row({ hours: "0.05" }));
    expect(marginTotals(many).loggedHours).toBe("15.00");
  });

  it("reports utilisation as null, not zero, with nothing logged", () => {
    expect(marginTotals([]).billableUtilisation).toBeNull();
  });
});

describe("marginMoney", () => {
  it("revenue - cost = margin", () => {
    const m = marginMoney([
      row({ costAmount: "10.00", revenueAmount: "50.00" }),
      row({ costAmount: "5.50", revenueAmount: "20.25" }),
    ]);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    expect(m.costAmount).toBe("15.50");
    expect(m.revenueAmount).toBe("70.25");
    expect(Number(m.grossMargin)).toBeCloseTo(
      Number(m.revenueAmount) - Number(m.costAmount),
      2,
    );
  });

  it("counts only costed rows, so an uncosted entry cannot inflate margin", () => {
    const m = marginMoney([
      row({ costAmount: "10.00", revenueAmount: "50.00" }),
      row({ costAmount: null, revenueAmount: null, currency: null }),
    ]);
    if (!m.ok) throw new Error("expected ok");
    expect(m.costAmount).toBe("10.00");
  });

  it("REFUSES to mix currencies rather than assuming 1:1", () => {
    // A wrong margin is worse than no margin: someone prices the next job off
    // it. This test exists to fail if anyone adds a 'helpful' fallback.
    const m = marginMoney([
      row({ currency: "USD" }),
      row({ currency: "PKR" }),
    ]);
    expect(m).toEqual({
      ok: false,
      reason: "currency-mismatch",
      currencies: ["PKR", "USD"],
    });
  });

  it("says so when nothing is costed at all", () => {
    const m = marginMoney([row({ costAmount: null, currency: null })]);
    expect(m).toMatchObject({ ok: false, reason: "not-costed" });
  });

  it("gives margin percentage as null, not Infinity, on zero revenue", () => {
    const m = marginMoney([row({ costAmount: "10.00", revenueAmount: "0.00" })]);
    if (!m.ok) throw new Error("expected ok");
    expect(m.grossMarginPct).toBeNull();
  });

  it("separates effective rate from billed rate", () => {
    // Two hours of work, one billable, one not; only the billable hour earned.
    const m = marginMoney([
      row({ hours: "1.00", billable: true, revenueAmount: "50.00", costAmount: "10.00" }),
      row({ hours: "1.00", billable: false, revenueAmount: "0.00", costAmount: "10.00" }),
    ]);
    if (!m.ok) throw new Error("expected ok");
    expect(m.effectiveRate).toBe("25.00");
    expect(m.billedRate).toBe("50.00");
  });
});

describe("contractView", () => {
  const budget = { budgetedHours: "100.00" };

  it("takes the platform fee once, off the contract", () => {
    const c = contractView(
      { contractValue: "10000.00", platformFeePct: "10.00", ...budget },
      "3000.00",
      "50.00",
    );
    expect(c.platformFee).toBe("1000.00");
    expect(c.netContract).toBe("9000.00");
    expect(c.contractMargin).toBe("6000.00");
  });

  it("distinguishes no fee recorded from a fee of zero", () => {
    const none = contractView(
      { contractValue: "10000.00", platformFeePct: null, ...budget },
      "0.00",
      "0.00",
    );
    expect(none.platformFee).toBeNull();
    expect(none.netContract).toBe("10000.00");

    const zero = contractView(
      { contractValue: "10000.00", platformFeePct: "0.00", ...budget },
      "0.00",
      "0.00",
    );
    expect(zero.platformFee).toBe("0.00");
  });

  it("has no contract margin without a contract, rather than margin against zero", () => {
    const c = contractView(
      { contractValue: null, platformFeePct: "10.00", ...budget },
      "3000.00",
      "50.00",
    );
    expect(c.contractAmount).toBeNull();
    expect(c.contractMargin).toBeNull();
    // The budget half still works on its own.
    expect(c.budgetBurn).toBeCloseTo(0.5, 5);
  });

  it("nulls the whole budget block when no budget is set", () => {
    const c = contractView(
      { contractValue: "10000.00", platformFeePct: null, budgetedHours: null },
      "0.00",
      "40.00",
    );
    expect(c.budgetBurn).toBeNull();
    expect(c.remainingBudgetHours).toBeNull();
  });

  it("reports overrun as negative remaining, not as zero", () => {
    const c = contractView(
      { contractValue: "10000.00", platformFeePct: null, budgetedHours: "100.00" },
      "0.00",
      "130.00",
    );
    expect(c.remainingBudgetHours).toBe("-30.00");
    expect(c.budgetBurn).toBeCloseTo(1.3, 5);
  });
});
