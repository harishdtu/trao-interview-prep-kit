export type Origin = "generated" | "user";

export interface Editable {
  origin: Origin;
  edited: boolean;
  pinned: boolean;
}

/** Wraps freshly-created content with default editable-state metadata. */
export function asGenerated<T>(content: T): T & Editable {
  return { ...content, origin: "generated", edited: false, pinned: false };
}

export function asUserCreated<T>(content: T): T & Editable {
  return { ...content, origin: "user", edited: false, pinned: false };
}

/**
 * Merge newly-generated items into an existing collection for one
 * category/section, WITHOUT ever discarding user edits or pinned items.
 *
 * Rules:
 *  - Any existing item that is pinned is kept exactly as-is.
 *  - Any existing item that is user-created or has been edited is kept
 *    exactly as-is (its `edited`/`origin` flags mark it as no longer
 *    safe to silently overwrite).
 *  - Only existing items that are still origin "generated", not edited,
 *    and not pinned are eligible to be replaced.
 *  - Newly generated items are appended to fill out the section, but
 *    IDs are kept stable/unique: new items never reuse an ID that is
 *    still present after the preserve step.
 *
 * `idOf` extracts a stable identifier from an item (e.g. question.id).
 */
export function mergeGenerated<T extends Editable>(
  existing: T[],
  freshlyGenerated: T[],
  idOf: (item: T) => string
): T[] {
  const preserved = existing.filter(
    (item) => item.pinned || item.edited || item.origin === "user"
  );
  const preservedIds = new Set(preserved.map(idOf));

  const replacement = freshlyGenerated
    .map((item) => asGenerated(stripEditable(item)) as T)
    .filter((item) => !preservedIds.has(idOf(item)));

  return [...preserved, ...replacement];
}

function stripEditable<T extends Editable>(item: T): Omit<T, keyof Editable> {
  const { origin, edited, pinned, ...rest } = item;
  return rest as Omit<T, keyof Editable>;
}
