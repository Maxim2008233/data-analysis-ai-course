"use client";
// Аккаунты (Supabase Auth): вход/регистрация по email и паролю, выход, восстановление и смена пароля,
// удаление аккаунта. При входе гостевой прогресс сливается с облачным.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "../supabase/client";
import { progressStore } from "../progress/store";
import { AUTH_ENABLED } from "../config";

interface AuthState {
  enabled: boolean;
  ready: boolean;
  user: User | null;
  notice: string | null;
  recovery: boolean;
  clearNotice: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string) => Promise<{ needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
  sendReset: (email: string) => Promise<void>;
  setNewPassword: (password: string) => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  deleteAccount: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes("invalid login credentials")) return "Неверный email или пароль.";
  if (m.includes("email not confirmed")) return "Email не подтверждён. Откройте письмо со ссылкой подтверждения.";
  if (m.includes("user already registered") || m.includes("already been registered")) return "Пользователь с таким email уже зарегистрирован. Войдите или восстановите пароль.";
  if (m.includes("password should be at least") || m.includes("at least 6")) return "Пароль слишком короткий: нужно не меньше 6 символов.";
  if (m.includes("weak") && m.includes("password")) return "Пароль слишком простой. Добавьте цифры и буквы разного регистра.";
  if (m.includes("rate limit") || m.includes("too many")) return "Слишком много попыток. Подождите немного и попробуйте снова.";
  if (m.includes("same") && m.includes("password")) return "Новый пароль должен отличаться от старого.";
  if (m.includes("unable to validate email") || m.includes("invalid email") || m.includes("email address") && m.includes("invalid"))
    return "Некорректный email.";
  if (m.includes("failed to fetch") || m.includes("network")) return "Нет связи с сервером. Проверьте интернет.";
  if (m.includes("auth session missing") || m.includes("session")) return "Сессия истекла. Войдите заново или запросите новую ссылку.";
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const sb = getSupabase();
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!AUTH_ENABLED);
  const [notice, setNotice] = useState<string | null>(null);
  const [recovery, setRecovery] = useState(false);
  const explicitSignOut = useRef(false);

  const handleUser = useCallback(
    async (u: User | null) => {
      setUser(u);
      if (!sb) return;
      if (u) {
        const { migrated } = await progressStore.attachUser(sb, u.id);
        if (migrated > 0) {
          const word = migrated % 10 === 1 && migrated % 100 !== 11 ? "решённая задача" : migrated % 10 >= 2 && migrated % 10 <= 4 && (migrated % 100 < 12 || migrated % 100 > 14) ? "решённые задачи" : "решённых задач";
          setNotice(`Перенесено ${migrated} ${word} из браузера в ваш аккаунт.`);
        }
      } else {
        await progressStore.detachUser({ clearCache: explicitSignOut.current });
        explicitSignOut.current = false;
      }
    },
    [sb]
  );

  useEffect(() => {
    progressStore.init();
    if (!sb) return;
    let active = true;
    sb.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      await handleUser(data.session?.user ?? null);
      setReady(true);
    });
    const { data: sub } = sb.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "INITIAL_SESSION") return; // обработано через getSession
      void handleUser(session?.user ?? null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [sb, handleUser]);

  const value = useMemo<AuthState>(() => {
    const need = () => {
      if (!sb) throw new Error("Аккаунты не настроены на этом сайте (нет ключей Supabase).");
      return sb;
    };
    return {
      enabled: AUTH_ENABLED,
      ready,
      user,
      notice,
      recovery,
      clearNotice: () => setNotice(null),
      async signIn(email, password) {
        const { error } = await need().auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw new Error(translateAuthError(error.message));
      },
      async signUp(email, password) {
        const { data, error } = await need().auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: `${window.location.origin}/login?confirmed=1` },
        });
        if (error) throw new Error(translateAuthError(error.message));
        // если пользователь уже существует, Supabase возвращает пустой список identities
        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          throw new Error("Пользователь с таким email уже зарегистрирован. Войдите или восстановите пароль.");
        }
        return { needsConfirmation: !data.session };
      },
      async signOut() {
        explicitSignOut.current = true;
        await progressStore.detachUser({ clearCache: true });
        await need().auth.signOut();
        setUser(null);
      },
      async sendReset(email) {
        const { error } = await need().auth.resetPasswordForEmail(email.trim(), {
          redirectTo: `${window.location.origin}/reset-password`,
        });
        if (error) throw new Error(translateAuthError(error.message));
      },
      async setNewPassword(password) {
        const { error } = await need().auth.updateUser({ password });
        if (error) throw new Error(translateAuthError(error.message));
        setRecovery(false);
      },
      async changePassword(current, next) {
        const client = need();
        const email = user?.email;
        if (!email) throw new Error("Сначала войдите в аккаунт.");
        const check = await client.auth.signInWithPassword({ email, password: current });
        if (check.error) throw new Error("Текущий пароль указан неверно.");
        const { error } = await client.auth.updateUser({ password: next });
        if (error) throw new Error(translateAuthError(error.message));
      },
      async deleteAccount() {
        const client = need();
        const { error } = await client.rpc("delete_own_account");
        if (error) throw new Error(translateAuthError(error.message));
        progressStore.forgetUser();
        explicitSignOut.current = true;
        await client.auth.signOut({ scope: "local" });
        setUser(null);
      },
    };
  }, [sb, ready, user, notice, recovery]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth вне AuthProvider");
  return ctx;
}
