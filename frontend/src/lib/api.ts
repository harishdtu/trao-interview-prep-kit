const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(body?.error?.message ?? "Request failed", res.status, body?.error?.code);
  }
  return body as T;
}

export const api = {
  register: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  login: (email: string, password: string) =>
    request<{ user: { id: string; email: string } }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  logout: () => request<void>("/auth/logout", { method: "POST" }),
  me: () => request<{ user: { id: string; email: string } }>("/auth/me"),

  listKits: () => request<{ kits: any[] }>("/api/kits"),
  createKit: (jd: string, company_url: string, days: number) =>
    request<{ kit: any }>("/api/kits", { method: "POST", body: JSON.stringify({ jd, company_url, days }) }),
  getKit: (id: string) => request<{ kit: any }>(`/api/kits/${id}`),
  deleteKit: (id: string) => request<void>(`/api/kits/${id}`, { method: "DELETE" }),
  startGeneration: (id: string) => request<{ status: string }>(`/api/kits/${id}/generate`, { method: "POST" }),
  getProgress: (id: string) => request<{ status: string; events: any[]; error: any }>(`/api/kits/${id}/progress`),

  regenerateCompanyBrief: (id: string) =>
    request<{ kit: any }>(`/api/kits/${id}/regenerate/company-brief`, { method: "POST" }),
  regenerateQuestions: (id: string, category: string) =>
    request<{ kit: any }>(`/api/kits/${id}/regenerate/questions/${category}`, { method: "POST" }),
  regenerateSchedule: (id: string) =>
    request<{ kit: any }>(`/api/kits/${id}/regenerate/schedule`, { method: "POST" }),

  addQuestion: (id: string, question: any) =>
    request<{ kit: any }>(`/api/kits/${id}/questions`, { method: "POST", body: JSON.stringify(question) }),
  patchQuestion: (id: string, questionId: string, patch: any) =>
    request<{ kit: any }>(`/api/kits/${id}/questions/${questionId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteQuestion: (id: string, questionId: string) =>
    request<{ kit: any }>(`/api/kits/${id}/questions/${questionId}`, { method: "DELETE" }),

  addFlashcard: (id: string, flashcard: any) =>
    request<{ kit: any }>(`/api/kits/${id}/flashcards`, { method: "POST", body: JSON.stringify(flashcard) }),
  patchFlashcard: (id: string, flashcardId: string, patch: any) =>
    request<{ kit: any }>(`/api/kits/${id}/flashcards/${flashcardId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteFlashcard: (id: string, flashcardId: string) =>
    request<{ kit: any }>(`/api/kits/${id}/flashcards/${flashcardId}`, { method: "DELETE" }),

  getPractice: (id: string) => request<{ flashcards: any[]; progress: any }>(`/api/kits/${id}/practice`),
  submitPractice: (id: string, flashcardId: string, confidence: 1 | 2 | 3) =>
    request<{ progress: any }>(`/api/kits/${id}/practice`, {
      method: "POST",
      body: JSON.stringify({ flashcardId, confidence }),
    }),

  weakSpots: (id: string) => request<any>(`/api/kits/${id}/weak-spots`),
};
