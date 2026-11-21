"use client";
// Браузерная часть соревнований: отправка прогнозов на сервер и таблица лидеров.
// Если ученик вошёл в аккаунт, к запросу добавляется его токен Supabase — сервер проверяет его сам.
import { getSupabase } from "../supabase/client";

export interface SubmissionData {
  ids: (number | string)[];
  predictions: (number | string)[];
}

/** Лучший результат ученика в таблице лидеров (уже в единицах метрики). */
export interface RecordedResult {
  best: number;
  bestSecond: number;
  submissions: number;
  place: number;
  participants: number;
}

export interface SubmitResponse {
  ok: boolean;
  error?: string;
  metric?: "mae" | "accuracy";
  /** Значение метрики: MAE (целое) или доля верных (до 4 знаков). */
  score?: number;
  /** Дополнительное число: медиана ошибки для MAE, число верных ответов для доли верных. */
  second?: number;
  mae?: number;
  medianAe?: number;
  accuracy?: number;
  correct?: number;
  n?: number;
  baseline?: { score: number; second: number };
  improvement?: number;
  limit?: number;
  remaining?: number;
  retryAfterMs?: number;
  countedAs?: "account" | "guest";
  leaderboard?: RecordedResult | null;
  leaderboardEnabled?: boolean;
  leaderboardError?: string | null;
}

export interface LeaderboardResponse {
  ok: boolean;
  enabled?: boolean;
  error?: string;
  rows?: { place: number; login: string | null; score: number; submissions: number; bestAt: string | null; mine: boolean }[];
  participants?: number;
  me?: { login: string | null; score: number | null; submissions: number; place: number | null } | null;
}

async function authHeader(): Promise<Record<string, string>> {
  const sb = getSupabase();
  if (!sb) return {};
  try {
    const { data } = await sb.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function request<T extends { ok: boolean; error?: string }>(url: string, init: RequestInit): Promise<T> {
  try {
    const res = await fetch(url, { ...init, cache: "no-store" });
    const body = (await res.json().catch(() => null)) as T | null;
    if (!body) return { ok: false, error: `Сервер ответил ${res.status} без результата. Попробуйте позже.` } as T;
    return body;
  } catch {
    return { ok: false, error: "Не удалось связаться с сервером проверки. Проверьте подключение к интернету." } as T;
  }
}

export async function submitPredictions(competitionId: string, data: SubmissionData): Promise<SubmitResponse> {
  return request<SubmitResponse>(`/api/competitions/${encodeURIComponent(competitionId)}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(await authHeader()) },
    body: JSON.stringify(data),
  });
}

export async function fetchLeaderboard(competitionId: string): Promise<LeaderboardResponse> {
  return request<LeaderboardResponse>(`/api/competitions/${encodeURIComponent(competitionId)}/leaderboard`, {
    headers: await authHeader(),
  });
}
