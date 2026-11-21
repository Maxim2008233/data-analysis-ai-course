"use client";
// Клиент Supabase для браузера. Если переменные окружения не заданы, сайт работает в гостевом режиме.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { AUTH_ENABLED, SUPABASE_ANON_KEY, SUPABASE_URL } from "../config";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!AUTH_ENABLED) return null;
  if (typeof window === "undefined") return null;
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // implicit: ссылки из писем (подтверждение, восстановление пароля) работают и на другом устройстве
        flowType: "implicit",
        storageKey: "dsc-auth",
      },
    });
  }
  return client;
}
