import { ProgressEvent } from "../generation/pipeline";

const progressByKitId = new Map<string, ProgressEvent[]>();

export function recordProgress(kitId: string, event: ProgressEvent) {
  const list = progressByKitId.get(kitId) ?? [];
  list.push(event);
  progressByKitId.set(kitId, list);
}

export function getProgress(kitId: string): ProgressEvent[] {
  return progressByKitId.get(kitId) ?? [];
}

export function clearProgress(kitId: string) {
  progressByKitId.delete(kitId);
}
