"use client";
// Формы входа, регистрации, восстановления и установки нового пароля.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { safeNext } from "@/lib/url";

const input = "w-full rounded-lg border border-line-strong bg-elev px-3 py-2.5 text-[0.97rem] outline-none focus:border-accent";

function Shell({ title, children, subtitle }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <h1 className="font-display text-3xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <div className="mt-2 text-sm text-muted">{subtitle}</div>}
      <div className="mt-6 paper p-5">{children}</div>
    </div>
  );
}

function Disabled() {
  return (
    <Shell title="Аккаунты не настроены">
      <p className="text-sm text-muted">
        На этом сайте не заданы ключи Supabase, поэтому вход недоступен. Всё работает и без входа: прогресс и код сохраняются в этом браузере. Владелец сайта может включить аккаунты по
        инструкции DEPLOY.md.
      </p>
      <Link href="/course" className="mt-4 inline-block text-accent-ink underline">
        К курсу
      </Link>
    </Shell>
  );
}

function Msg({ kind, children }: { kind: "error" | "ok" | "info"; children: ReactNode }) {
  const cls = kind === "error" ? "bg-bad-soft text-bad" : kind === "ok" ? "bg-ok-soft text-ok" : "bg-info-soft text-info";
  return (
    <p className={`rounded-lg px-3 py-2 text-sm ${cls}`} role={kind === "error" ? "alert" : "status"} data-testid={`auth-${kind}`}>
      {children}
    </p>
  );
}

export function LoginForm() {
  const auth = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(params.get("next")); // только путь этого сайта: иначе ссылка увела бы ученика на чужой сайт

  useEffect(() => {
    if (auth.ready && auth.user) router.replace(next);
  }, [auth.ready, auth.user, next, router]);

  if (!auth.enabled) return <Disabled />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await auth.signIn(email, password);
      router.replace(next);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell title="Вход" subtitle={<>Прогресс и код будут доступны на любом устройстве. Решённые без входа задачи перенесутся в аккаунт.</>}>
      <form onSubmit={submit} className="space-y-3" data-testid="login-form">
        {params.get("confirmed") && <Msg kind="ok">Email подтверждён. Войдите с вашим паролем.</Msg>}
        {params.get("reset") && <Msg kind="ok">Пароль изменён. Войдите с новым паролем.</Msg>}
        <label className="block text-sm">
          Email
          <input className={`${input} mt-1`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" />
        </label>
        <label className="block text-sm">
          Пароль
          <input className={`${input} mt-1`} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} name="password" />
        </label>
        {err && <Msg kind="error">{err}</Msg>}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-ok py-2.5 font-semibold text-white disabled:opacity-60 dark:text-[#0e1a13]">
          {busy ? "Входим…" : "Войти"}
        </button>
        <div className="flex flex-wrap justify-between gap-2 text-sm">
          <Link href="/register" className="text-accent-ink underline">
            Регистрация
          </Link>
          <Link href="/forgot-password" className="text-accent-ink underline">
            Забыли пароль?
          </Link>
        </div>
      </form>
    </Shell>
  );
}

export function RegisterForm() {
  const auth = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!auth.enabled) return <Disabled />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) return setErr("Пароль должен быть не короче 8 символов.");
    if (password !== password2) return setErr("Пароли не совпадают.");
    setBusy(true);
    try {
      const { needsConfirmation } = await auth.signUp(email, password);
      if (needsConfirmation) setDone(true);
      else router.replace("/course");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (done)
    return (
      <Shell title="Проверьте почту">
        <Msg kind="ok">
          Мы отправили письмо на {email}. Перейдите по ссылке в письме, чтобы подтвердить адрес, затем войдите. Письмо может попасть в «Спам».
        </Msg>
      </Shell>
    );

  return (
    <Shell title="Регистрация" subtitle={<>Нужны только email и пароль. Задачи, решённые без входа, перенесутся в аккаунт.</>}>
      <form onSubmit={submit} className="space-y-3" data-testid="register-form">
        <label className="block text-sm">
          Email
          <input className={`${input} mt-1`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" />
        </label>
        <label className="block text-sm">
          Пароль (не короче 8 символов)
          <input className={`${input} mt-1`} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} name="password" />
        </label>
        <label className="block text-sm">
          Пароль ещё раз
          <input className={`${input} mt-1`} type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} name="password2" />
        </label>
        {err && <Msg kind="error">{err}</Msg>}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-ok py-2.5 font-semibold text-white disabled:opacity-60 dark:text-[#0e1a13]">
          {busy ? "Создаём аккаунт…" : "Зарегистрироваться"}
        </button>
        <p className="text-sm">
          Уже есть аккаунт?{" "}
          <Link href="/login" className="text-accent-ink underline">
            Войти
          </Link>
        </p>
      </form>
    </Shell>
  );
}

export function ForgotForm() {
  const auth = useAuth();
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!auth.enabled) return <Disabled />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await auth.sendReset(email);
      setSent(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Shell title="Восстановление пароля" subtitle="Пришлём ссылку для установки нового пароля.">
      {sent ? (
        <Msg kind="ok">Если аккаунт с адресом {email} существует, письмо со ссылкой уже отправлено. Ссылка действует ограниченное время.</Msg>
      ) : (
        <form onSubmit={submit} className="space-y-3" data-testid="forgot-form">
          <label className="block text-sm">
            Email
            <input className={`${input} mt-1`} type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} name="email" />
          </label>
          {err && <Msg kind="error">{err}</Msg>}
          <button type="submit" disabled={busy} className="w-full rounded-md bg-ok py-2.5 font-semibold text-white disabled:opacity-60 dark:text-[#0e1a13]">
            {busy ? "Отправляем…" : "Отправить ссылку"}
          </button>
        </form>
      )}
    </Shell>
  );
}

export function ResetPasswordForm() {
  const auth = useAuth();
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 2500);
    return () => clearTimeout(t);
  }, []);
  if (!auth.enabled) return <Disabled />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    if (password.length < 8) return setErr("Пароль должен быть не короче 8 символов.");
    if (password !== password2) return setErr("Пароли не совпадают.");
    setBusy(true);
    try {
      await auth.setNewPassword(password);
      router.replace("/profile?password=changed");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!auth.user) {
    return (
      <Shell title="Новый пароль">
        {!waited || !auth.ready ? (
          <p className="text-sm text-muted">Проверяем ссылку…</p>
        ) : (
          <Msg kind="error">
            Ссылка недействительна или устарела. Запросите новую на странице{" "}
            <Link href="/forgot-password" className="underline">
              восстановления пароля
            </Link>
            .
          </Msg>
        )}
      </Shell>
    );
  }

  return (
    <Shell title="Новый пароль" subtitle={<>Аккаунт: {auth.user.email}</>}>
      <form onSubmit={submit} className="space-y-3" data-testid="reset-form">
        <label className="block text-sm">
          Новый пароль (не короче 8 символов)
          <input className={`${input} mt-1`} type="password" autoComplete="new-password" required value={password} onChange={(e) => setPassword(e.target.value)} name="password" />
        </label>
        <label className="block text-sm">
          Новый пароль ещё раз
          <input className={`${input} mt-1`} type="password" autoComplete="new-password" required value={password2} onChange={(e) => setPassword2(e.target.value)} name="password2" />
        </label>
        {err && <Msg kind="error">{err}</Msg>}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-ok py-2.5 font-semibold text-white disabled:opacity-60 dark:text-[#0e1a13]">
          {busy ? "Сохраняем…" : "Сохранить пароль"}
        </button>
      </form>
    </Shell>
  );
}
