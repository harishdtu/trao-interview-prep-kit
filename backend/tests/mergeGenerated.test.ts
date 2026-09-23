import { describe, it, expect } from "vitest";
import { mergeGenerated, asGenerated, asUserCreated, Editable } from "../src/kits/editableEntity";

interface Q extends Editable {
  id: string;
  prompt: string;
}

const idOf = (q: Q) => q.id;

describe("mergeGenerated (regeneration merge logic)", () => {
  it("preserves a pinned question untouched when regenerating its category", () => {
    const existing: Q[] = [
      { id: "q1", prompt: "original pinned prompt", origin: "generated", edited: false, pinned: true },
    ];
    const fresh: Q[] = [{ id: "q1", prompt: "new prompt", edited: false, origin: "generated", pinned: false }];
    const result = mergeGenerated(existing, fresh, idOf);
    expect(result).toHaveLength(1);
    expect(result[0].prompt).toBe("original pinned prompt");
    expect(result[0].pinned).toBe(true);
  });

  it("preserves a user-edited question untouched when regenerating its category", () => {
    const existing: Q[] = [
      { id: "q3", prompt: "user's edited version", origin: "generated", edited: true, pinned: false },
    ];
    const fresh: Q[] = [{ id: "q3", prompt: "regenerated version", edited: false, origin: "generated", pinned: false }];
    const result = mergeGenerated(existing, fresh, idOf);
    expect(result[0].prompt).toBe("user's edited version");
  });

  it("preserves a user-created question even though regeneration produced no matching id", () => {
    const existing: Q[] = [asUserCreated({ id: "q99", prompt: "manually added" }) as Q];
    const fresh: Q[] = [{ id: "q1", prompt: "generated q1", edited: false, origin: "generated", pinned: false }];
    const result = mergeGenerated(existing, fresh, idOf);
    const ids = result.map((r) => r.id);
    expect(ids).toContain("q99");
    expect(ids).toContain("q1");
  });

  it("replaces an untouched generated question with the fresh regenerated content", () => {
    const existing: Q[] = [asGenerated({ id: "q1", prompt: "stale" }) as Q];
    const fresh: Q[] = [{ id: "q1", prompt: "fresh content", edited: false, origin: "generated", pinned: false }];
    const result = mergeGenerated(existing, fresh, idOf);
    expect(result[0].prompt).toBe("fresh content");
    expect(result[0].origin).toBe("generated");
  });

  it("does not let a fresh item overwrite a preserved id even if generation reused that id", () => {
    const existing: Q[] = [
      { id: "q1", prompt: "pinned original", origin: "generated", edited: false, pinned: true },
    ];
    const fresh: Q[] = [
      { id: "q1", prompt: "attempted overwrite", edited: false, origin: "generated", pinned: false },
      { id: "q2", prompt: "brand new", edited: false, origin: "generated", pinned: false },
    ];
    const result = mergeGenerated(existing, fresh, idOf);
    const byId = Object.fromEntries(result.map((r) => [r.id, r]));
    expect(byId["q1"].prompt).toBe("pinned original");
    expect(byId["q2"].prompt).toBe("brand new");
  });
});
