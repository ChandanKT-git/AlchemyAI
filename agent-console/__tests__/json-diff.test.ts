// ─────────────────────────────────────────────────────────────
// Tests for deepDiff and computeChangedPathSet
//
// Coverage matrix (from Milestone 9 spec):
//  ✓ Identical objects → empty diff
//  ✓ Added top-level key
//  ✓ Removed top-level key
//  ✓ Changed primitive value
//  ✓ Nested object changes (path tracking)
//  ✓ Array element added / removed / changed
//  ✓ Large object performance (<100ms for 500KB)
//  ✓ null / undefined edge cases
//  ✓ computeChangedPathSet — ancestor bubble-up
// ─────────────────────────────────────────────────────────────

import {
  deepDiff,
  computeChangedPathSet,
  getAncestorPaths,
} from "@/lib/context-inspector/diff";

// ── Identical inputs ──────────────────────────────────────────

describe("identical inputs → empty diff", () => {
  test("identical flat objects", () => {
    const obj = { a: 1, b: "hello", c: true };
    const d = deepDiff(obj, obj);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
  });

  test("deep-equal objects (different references)", () => {
    const prev = { x: { y: [1, 2, 3] } };
    const next = { x: { y: [1, 2, 3] } };
    // Different references but same values — deepDiff walks until
    // it hits primitives, so equal primitives produce empty diff
    const d = deepDiff(prev, next);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
  });

  test("null === null", () => {
    const d = deepDiff(null, null);
    expect(d.added).toHaveLength(0);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
  });

  test("primitive number equality", () => {
    expect(deepDiff(42, 42)).toMatchObject({ added: [], removed: [], changed: [] });
  });

  test("empty objects", () => {
    expect(deepDiff({}, {})).toMatchObject({ added: [], removed: [], changed: [] });
  });
});

// ── Added keys ────────────────────────────────────────────────

describe("added top-level key", () => {
  test("single key added", () => {
    const d = deepDiff({ a: 1 }, { a: 1, b: 2 });
    expect(d.added).toEqual(["b"]);
    expect(d.removed).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
  });

  test("multiple keys added at once", () => {
    const d = deepDiff({}, { x: 1, y: 2, z: 3 });
    expect(d.added).toHaveLength(3);
    expect(d.added).toContain("x");
    expect(d.added).toContain("y");
    expect(d.added).toContain("z");
  });
});

// ── Removed keys ─────────────────────────────────────────────

describe("removed top-level key", () => {
  test("single key removed", () => {
    const d = deepDiff({ a: 1, b: 2 }, { a: 1 });
    expect(d.removed).toEqual(["b"]);
    expect(d.added).toHaveLength(0);
    expect(d.changed).toHaveLength(0);
  });

  test("all keys removed", () => {
    const d = deepDiff({ x: 1, y: 2 }, {});
    expect(d.removed).toHaveLength(2);
    expect(d.removed).toContain("x");
    expect(d.removed).toContain("y");
  });
});

// ── Changed primitive values ──────────────────────────────────

describe("changed primitive value", () => {
  test("number changed", () => {
    const d = deepDiff({ x: 10 }, { x: 20 });
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]).toMatchObject({ path: "x", oldValue: 10, newValue: 20 });
  });

  test("string changed", () => {
    const d = deepDiff({ name: "Alice" }, { name: "Bob" });
    expect(d.changed[0]).toMatchObject({ path: "name", oldValue: "Alice", newValue: "Bob" });
  });

  test("boolean flipped", () => {
    const d = deepDiff({ active: true }, { active: false });
    expect(d.changed[0]).toMatchObject({ path: "active", oldValue: true, newValue: false });
  });

  test("type change (string → number) counts as changed", () => {
    const d = deepDiff({ val: "42" }, { val: 42 });
    expect(d.changed[0]).toMatchObject({ path: "val", oldValue: "42", newValue: 42 });
  });

  test("type change (object → null) counts as changed", () => {
    const d = deepDiff({ data: { x: 1 } }, { data: null });
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].path).toBe("data");
  });
});

// ── Nested object changes ─────────────────────────────────────

describe("nested object changes", () => {
  test("tracks full dot-separated path", () => {
    const d = deepDiff(
      { meta: { author: "Alice", version: 1 } },
      { meta: { author: "Bob",   version: 1 } }
    );
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].path).toBe("meta.author");
    expect(d.changed[0].oldValue).toBe("Alice");
    expect(d.changed[0].newValue).toBe("Bob");
  });

  test("deeply nested 3-level path", () => {
    const d = deepDiff({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });
    expect(d.changed[0].path).toBe("a.b.c");
  });

  test("nested key added", () => {
    const d = deepDiff({ config: { timeout: 30 } }, { config: { timeout: 30, retries: 3 } });
    expect(d.added).toContain("config.retries");
  });

  test("nested key removed", () => {
    const d = deepDiff({ config: { timeout: 30, retries: 3 } }, { config: { timeout: 30 } });
    expect(d.removed).toContain("config.retries");
  });
});

// ── Array changes ─────────────────────────────────────────────

describe("array element changes", () => {
  test("element added at end", () => {
    const d = deepDiff({ items: [1, 2] }, { items: [1, 2, 3] });
    expect(d.added).toContain("items[2]");
  });

  test("element removed from end", () => {
    const d = deepDiff({ items: [1, 2, 3] }, { items: [1, 2] });
    expect(d.removed).toContain("items[2]");
  });

  test("element value changed", () => {
    const d = deepDiff([10, 20, 30], [10, 99, 30]);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].path).toBe("[1]");
    expect(d.changed[0].oldValue).toBe(20);
    expect(d.changed[0].newValue).toBe(99);
  });

  test("nested array element path", () => {
    const d = deepDiff(
      { tables: [{ name: "users" }] },
      { tables: [{ name: "accounts" }] }
    );
    expect(d.changed[0].path).toBe("tables[0].name");
  });

  test("root-level array", () => {
    const d = deepDiff([1, 2, 3], [1, 2, 3, 4]);
    expect(d.added).toContain("[3]");
  });
});

// ── Null / undefined edge cases ───────────────────────────────

describe("null and undefined edge cases", () => {
  test("null to value", () => {
    const d = deepDiff(null, 42);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0]).toMatchObject({ path: "", oldValue: null, newValue: 42 });
  });

  test("value to null", () => {
    const d = deepDiff(42, null);
    expect(d.changed).toHaveLength(1);
    expect(d.changed[0].newValue).toBeNull();
  });

  test("null field to object field", () => {
    const d = deepDiff({ data: null }, { data: { x: 1 } });
    expect(d.changed[0].path).toBe("data");
    expect(d.changed[0].oldValue).toBeNull();
  });

  test("object field to null field", () => {
    const d = deepDiff({ data: { x: 1 } }, { data: null });
    expect(d.changed[0].path).toBe("data");
    expect(d.changed[0].newValue).toBeNull();
  });

  test("undefined value in object key (treated as present in next)", () => {
    const prev = { a: 1 };
    const next = { a: 1, b: undefined as unknown as null };
    // "b" is an own property of next — it is added
    const d = deepDiff(prev, next);
    expect(d.added).toContain("b");
  });
});

// ── Large object performance ──────────────────────────────────

describe("performance: large object <100ms", () => {
  test("500KB object diffed in under 100ms", () => {
    // Build a ~500KB object with 5000 keys, each with nested structure
    const prev: Record<string, unknown> = {};
    for (let i = 0; i < 5000; i++) {
      prev[`key_${i}`] = {
        id: i,
        value: i * 1.5,
        name: `item_${i}`,
        meta: { created: i, updated: i * 2, tags: ["a", "b", "c"] },
      };
    }

    // Modify one entry
    const next = {
      ...prev,
      key_999: {
        id: 999,
        value: 9999,
        name: "changed_item",
        meta: { created: 999, updated: 0, tags: ["x"] },
      },
    };

    const start = performance.now();
    const d = deepDiff(prev, next);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
    // Sanity check: the diff found our change
    expect(d.changed.length + d.added.length + d.removed.length).toBeGreaterThan(0);
  });
});

// ── getAncestorPaths ──────────────────────────────────────────

describe("getAncestorPaths", () => {
  test("dot-separated path", () => {
    expect(getAncestorPaths("a.b.c")).toEqual(["a.b", "a"]);
  });

  test("array in path", () => {
    expect(getAncestorPaths("items[2]")).toEqual(["items"]);
  });

  test("mixed dot and bracket", () => {
    expect(getAncestorPaths("tables[0].name")).toEqual(["tables[0]", "tables"]);
  });

  test("root array element has no ancestors", () => {
    expect(getAncestorPaths("[0]")).toEqual([]);
  });

  test("single top-level key has no ancestors", () => {
    expect(getAncestorPaths("foo")).toEqual([]);
  });
});

// ── computeChangedPathSet ─────────────────────────────────────

describe("computeChangedPathSet", () => {
  test("includes all ancestor paths for added", () => {
    const paths = computeChangedPathSet({
      added: ["a.b.c"],
      removed: [],
      changed: [],
    });
    expect(paths.has("a.b.c")).toBe(true);
    expect(paths.has("a.b")).toBe(true);
    expect(paths.has("a")).toBe(true);
  });

  test("includes all ancestor paths for removed", () => {
    const paths = computeChangedPathSet({
      added: [],
      removed: ["config.timeout"],
      changed: [],
    });
    expect(paths.has("config.timeout")).toBe(true);
    expect(paths.has("config")).toBe(true);
  });

  test("includes all ancestor paths for changed", () => {
    const paths = computeChangedPathSet({
      added: [],
      removed: [],
      changed: [{ path: "tables[0].name", oldValue: "users", newValue: "accounts" }],
    });
    expect(paths.has("tables[0].name")).toBe(true);
    expect(paths.has("tables[0]")).toBe(true);
    expect(paths.has("tables")).toBe(true);
  });

  test("merges paths from all change types", () => {
    const paths = computeChangedPathSet({
      added: ["x.y"],
      removed: ["a.b"],
      changed: [{ path: "p.q.r", oldValue: 1, newValue: 2 }],
    });
    // Added ancestors
    expect(paths.has("x")).toBe(true);
    // Removed ancestors
    expect(paths.has("a")).toBe(true);
    // Changed ancestors
    expect(paths.has("p.q")).toBe(true);
    expect(paths.has("p")).toBe(true);
  });

  test("empty diff → empty set", () => {
    const paths = computeChangedPathSet({ added: [], removed: [], changed: [] });
    expect(paths.size).toBe(0);
  });
});
