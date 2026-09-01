import { describe, expect, it } from "vitest";
import {
  listHref,
  nextSort,
  offsetFor,
  pageInfo,
  parseListParams,
} from "./list-params";

const SORTABLE = ["name", "created"] as const;

describe("parseListParams", () => {
  it("defaults to page 1 with no filters", () => {
    const p = parseListParams({});
    expect(p).toMatchObject({ q: "", sort: null, desc: false, page: 1 });
  });

  it("trims and caps the search", () => {
    expect(parseListParams({ q: "  hello  " }).q).toBe("hello");
    expect(parseListParams({ q: "x".repeat(500) }).q).toHaveLength(120);
  });

  it("accepts only allow-listed sort keys", () => {
    expect(parseListParams({ sort: "name" }, { sortable: SORTABLE }).sort).toBe("name");
    // An arbitrary key must never reach a query builder.
    expect(parseListParams({ sort: "; drop table" }, { sortable: SORTABLE }).sort).toBeNull();
  });

  it("reads a leading dash as descending", () => {
    const p = parseListParams({ sort: "-created" }, { sortable: SORTABLE });
    expect(p).toMatchObject({ sort: "created", desc: true });
  });

  it("keeps the default direction when the key is rejected", () => {
    const p = parseListParams(
      { sort: "-nope" },
      { sortable: SORTABLE, defaultSort: "created", defaultDesc: true },
    );
    expect(p).toMatchObject({ sort: "created", desc: true });
  });

  it("falls back on junk pages rather than erroring", () => {
    for (const page of ["0", "-3", "abc", ""]) {
      expect(parseListParams({ page }).page).toBe(1);
    }
  });

  it("caps absurd page numbers", () => {
    expect(parseListParams({ page: "999999999" }).page).toBe(10_000);
  });

  it("takes the first value when a param repeats", () => {
    expect(parseListParams({ q: ["a", "b"] }).q).toBe("a");
  });
});

describe("offsetFor", () => {
  it("is zero on page 1", () => {
    expect(offsetFor(parseListParams({}, { pageSize: 25 }))).toBe(0);
  });
  it("skips whole pages", () => {
    expect(offsetFor(parseListParams({ page: "3" }, { pageSize: 25 }))).toBe(50);
  });
});

describe("listHref", () => {
  it("preserves other params", () => {
    expect(listHref("/audit", { q: "rayan" }, { sort: "name" })).toBe(
      "/audit?q=rayan&sort=name",
    );
  });

  it("drops a param set to null", () => {
    expect(listHref("/audit", { q: "rayan", sort: "name" }, { q: null })).toBe(
      "/audit?sort=name",
    );
  });

  it("returns a bare path when nothing is left", () => {
    expect(listHref("/audit", { q: "x" }, { q: null })).toBe("/audit");
  });

  it("resets to page 1 when a filter changes", () => {
    // Staying on page 7 of a list that just got shorter shows an empty table.
    expect(listHref("/audit", { page: "7" }, { q: "rayan" })).toBe(
      "/audit?q=rayan",
    );
  });

  it("keeps the page when the page is what changed", () => {
    expect(listHref("/audit", { q: "a", page: "2" }, { page: 3 })).toBe(
      "/audit?q=a&page=3",
    );
  });

  it("never writes page=1 explicitly", () => {
    expect(listHref("/audit", { q: "a" }, { page: 1 })).toBe("/audit?q=a");
  });
});

describe("nextSort", () => {
  it("starts ascending", () => {
    expect(nextSort(parseListParams({}), "name")).toBe("name");
  });

  it("toggles to descending on the active ascending column", () => {
    const p = parseListParams({ sort: "name" }, { sortable: SORTABLE });
    expect(nextSort(p, "name")).toBe("-name");
  });

  it("returns to ascending from descending", () => {
    const p = parseListParams({ sort: "-name" }, { sortable: SORTABLE });
    expect(nextSort(p, "name")).toBe("name");
  });
});

describe("pageInfo", () => {
  it("describes a middle page", () => {
    const p = parseListParams({ page: "2" }, { pageSize: 50 });
    expect(pageInfo(p, 213)).toMatchObject({
      page: 2, pages: 5, from: 51, to: 100, hasPrev: true, hasNext: true,
    });
  });

  it("clamps a page past the end", () => {
    const p = parseListParams({ page: "99" }, { pageSize: 50 });
    expect(pageInfo(p, 60)).toMatchObject({ page: 2, pages: 2, hasNext: false });
  });

  it("reports an empty list as 0 of 0", () => {
    expect(pageInfo(parseListParams({}), 0)).toMatchObject({
      from: 0, to: 0, pages: 1, hasPrev: false, hasNext: false,
    });
  });
});
