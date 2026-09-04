import { describe, expect, it } from "vitest";
import { isSaveablePath, normaliseViewQuery, viewHref } from "./saved-view";

describe("isSaveablePath", () => {
  it("accepts the screens that have lists", () => {
    expect(isSaveablePath("/tasks")).toBe(true);
    expect(isSaveablePath("/reports")).toBe(true);
  });

  it("refuses another origin", () => {
    // The failure this exists to prevent: a saved "view" that navigates a
    // colleague off the app entirely.
    expect(isSaveablePath("https://evil.example/tasks")).toBe(false);
    expect(isSaveablePath("//evil.example")).toBe(false);
  });

  it("refuses traversal and scheme tricks", () => {
    for (const p of [
      "/tasks/../../admin/users",
      "/../etc/passwd",
      "javascript:alert(1)",
      "/tasks\\@evil.example",
      "",
    ]) {
      expect(isSaveablePath(p), p).toBe(false);
    }
  });

  it("refuses a path that merely starts with an allowed one", () => {
    // Allow-list by equality, not by prefix: `startsWith("/tasks")` would
    // accept `/tasksomething` and any path nested under it.
    expect(isSaveablePath("/tasks-secret")).toBe(false);
    expect(isSaveablePath("/tasks/1")).toBe(false);
  });
});

describe("normaliseViewQuery", () => {
  it("drops the leading question mark", () => {
    expect(normaliseViewQuery("?status=done")).toBe("status=done");
  });

  it("drops paging — a view is a set of filters, not page 4 of them", () => {
    expect(normaliseViewQuery("status=done&page=4")).toBe("status=done");
  });

  it("drops empty values so they cannot pile up", () => {
    expect(normaliseViewQuery("q=&status=done&assignee=")).toBe("status=done");
  });

  it("sorts keys so the same filters store identically", () => {
    expect(normaliseViewQuery("status=done&assignee=x")).toBe(
      normaliseViewQuery("assignee=x&status=done"),
    );
  });

  it("keeps an empty query empty rather than inventing one", () => {
    expect(normaliseViewQuery("")).toBe("");
    expect(normaliseViewQuery("?")).toBe("");
  });

  it("escapes values on the way back out", () => {
    const q = normaliseViewQuery("q=a%20b%26c=d");
    expect(viewHref("/tasks", q)).toBe("/tasks?q=a+b%26c%3Dd");
  });
});

describe("viewHref", () => {
  it("omits the question mark when there is no query", () => {
    expect(viewHref("/tasks", "")).toBe("/tasks");
  });
});
