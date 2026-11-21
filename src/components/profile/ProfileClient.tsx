"use client";
// Профиль: прогресс по модулям, статистика, экспорт/импорт, сброс, смена пароля, удаление аккаунта.
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, type FormEvent } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { progressStore, useAllProgress, useProgressVersion } from "@/lib/progress/store";
import { courseStats, moduleStats } from "@/lib/progress/stats";
import { makeExport, parseImport } from "@/lib/progress/merge";
import type { CourseIndex } from "@/lib/content/types";
import { Button, Card, ProgressBar } from "../ui";

const input = "w-full rounded-lg border border-line-strong bg-elev px-3 py-2 text-[0.95rem] outline-none focus:border-accent";

function Section({ title, children, id }: { title: string; children: React.ReactNode; id?: string }) {
  return (
    <Card className="p-5">
      <h2 className="mb-3 text-lg font-semibold" id={id}>
        {title}
      </h2>
      {children}
    </Card>
  );
}

function ChangePassword() {
  const auth = useAuth();
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [next2, setNext2] = useState("");
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next.length < 8) return setMsg({ kind: "error", text: "Новый пароль должен быть не короче 8 символов." });
    if (next !== next2) return setMsg({ kind: "error", text: "Новые пароли не совпадают." });
    setBusy(true);
    try {
      await auth.changePassword(cur, next);
      setMsg({ kind: "ok", text: "Пароль изменён. Используйте новый пароль при следующем входе." });
      setCur("");
      setNext("");
      setNext2("");
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit} className="grid gap-3 sm:max-w-md" data-testid="change-password-form">
      <label className="text-sm">
        Текущий пароль
        <input className={`${input} mt-1`} type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required name="current" />
      </label>
      <label className="text-sm">
        Новый пароль (не короче 8 символов)
        <input className={`${input} mt-1`} type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} required name="new" />
      </label>
      <label className="text-sm">
        Новый пароль ещё раз
        <input className={`${input} mt-1`} type="password" autoComplete="new-password" value={next2} onChange={(e) => setNext2(e.target.value)} required name="new2" />
      </label>
      {msg && (
        <p className={`rounded-lg px-3 py-2 text-sm ${msg.kind === "ok" ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`} data-testid={`password-${msg.kind}`}>
          {msg.text}
        </p>
      )}
      <div>
        <Button type="submit" variant="primary" disabled={busy}>
          {busy ? "Сохраняем…" : "Сменить пароль"}
        </Button>
      </div>
    </form>
  );
}

function DeleteAccount() {
  const auth = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function del() {
    setErr(null);
    setBusy(true);
    try {
      await auth.deleteAccount();
      router.replace("/?deleted=1");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!open)
    return (
      <Button variant="danger" onClick={() => setOpen(true)} data-testid="delete-account">
        Удалить аккаунт
      </Button>
    );
  return (
    <div className="space-y-3 rounded-xl border border-bad/40 bg-bad-soft p-4">
      <p className="text-sm text-ink">
        Аккаунт и весь облачный прогресс будут удалены безвозвратно. Чтобы подтвердить, введите слово <b>УДАЛИТЬ</b>.
      </p>
      <input className={input} value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-label="Подтверждение удаления" data-testid="delete-confirm-input" />
      {err && <p className="text-sm text-bad">{err}</p>}
      <div className="flex gap-2">
        <Button variant="danger" disabled={confirm.trim().toUpperCase() !== "УДАЛИТЬ" || busy} onClick={del} data-testid="delete-confirm">
          {busy ? "Удаляем…" : "Удалить навсегда"}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

export function ProfileClient({ index }: { index: CourseIndex }) {
  const auth = useAuth();
  const items = useAllProgress();
  useProgressVersion();
  const params = useSearchParams();
  const stats = courseStats(index, items);
  const fileRef = useRef<HTMLInputElement>(null);
  const [ioMsg, setIoMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [resetOpen, setResetOpen] = useState(false);

  function doExport() {
    const data = makeExport(progressStore.all());
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `progress-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setIoMsg({ kind: "ok", text: "Файл прогресса сохранён." });
  }

  async function doImport(file: File) {
    setIoMsg(null);
    try {
      const text = await file.text();
      const parsed = parseImport(text);
      const n = progressStore.importItems(parsed);
      setIoMsg({ kind: "ok", text: `Импортировано записей: ${n}. Решённые задачи объединены с текущими, для кода выбрана более свежая версия.` });
    } catch (e) {
      setIoMsg({ kind: "error", text: (e as Error).message });
    }
  }

  async function doReset() {
    try {
      await progressStore.resetAll();
      setResetOpen(false);
      setIoMsg({ kind: "ok", text: "Прогресс сброшен." });
    } catch (e) {
      setIoMsg({ kind: "error", text: "Не удалось сбросить прогресс: " + (e as Error).message });
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 px-4 py-8">
      <h1 className="font-display text-4xl font-semibold tracking-tight">Профиль</h1>
      {params.get("password") === "changed" && <p className="rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok">Новый пароль сохранён.</p>}

      <Section title="Аккаунт">
        {!auth.enabled ? (
          <p className="text-sm text-muted">Аккаунты на этом сайте не настроены. Прогресс и код хранятся в этом браузере — используйте экспорт, чтобы перенести их.</p>
        ) : !auth.ready ? (
          <p className="text-sm text-muted">Загружаем…</p>
        ) : auth.user ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm">
              Вы вошли как <b data-testid="profile-email">{auth.user.email}</b>. Прогресс сохраняется в облаке и доступен на любом устройстве.
            </p>
            <Button variant="secondary" onClick={() => auth.signOut()} data-testid="logout" className="sm:ml-auto">
              Выйти
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted">
              Вы не вошли. Прогресс и код сохраняются только в этом браузере. Войдите, чтобы они были доступны на любом устройстве: решённые задачи перенесутся в аккаунт.
            </p>
            <div className="flex gap-2">
              <Link href="/login?next=/profile" className="rounded-md bg-ok px-3.5 py-2 text-sm font-semibold text-white dark:text-[#0e1a13]">
                Войти
              </Link>
              <Link href="/register" className="rounded-lg border border-line-strong px-3.5 py-2 text-sm font-medium">
                Регистрация
              </Link>
            </div>
          </div>
        )}
      </Section>

      <Section title="Статистика">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-testid="profile-stats">
          {[
            ["Решено задач", `${stats.solved} / ${stats.tasks}`, "stat-solved"],
            ["Уроков пройдено", `${stats.doneLessons} / ${stats.lessons}`, "stat-lessons"],
            ["Проверок (попыток)", String(stats.attempts), "stat-attempts"],
            ["Открыто подсказок", String(stats.hints), "stat-hints"],
          ].map(([label, value, id]) => (
            <div key={id} className="rounded-xl bg-soft p-3">
              <p className="text-xs text-muted">{label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums" data-testid={id}>
                {value}
              </p>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">Подсмотренных решений: {stats.solutions}. Подсказки и решения не снижают результат — это просто отметка для вас.</p>
      </Section>

      <Section title="Прогресс по модулям">
        <ul className="space-y-3">
          {index.modules.map((m) => {
            const s = moduleStats(m, items);
            return (
              <li key={m.id}>
                <div className="mb-1 flex flex-wrap justify-between gap-2 text-sm">
                  <Link href={`/course#${m.id}`} className="font-medium hover:underline">
                    {m.short === m.label ? m.label : `${m.label}. ${m.short}`}
                  </Link>
                  <span className="text-muted">{s.tasks ? `${s.solvedTasks} из ${s.tasks} задач` : `${s.doneLessons} из ${s.lessons} уроков`}</span>
                </div>
                <ProgressBar value={s.tasks ? s.solvedTasks : s.doneLessons} max={s.tasks || s.lessons} />
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Экспорт, импорт и сброс прогресса">
        <p className="mb-3 text-sm text-muted">Экспорт сохраняет весь прогресс и код в JSON-файл. Импорт объединяет файл с текущим прогрессом — ничего не теряется.</p>
        <div className="flex flex-wrap gap-2">
          <Button onClick={doExport} data-testid="export-progress">
            ⬇ Экспорт прогресса
          </Button>
          <Button onClick={() => fileRef.current?.click()} data-testid="import-progress">
            ⬆ Импорт из файла
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            data-testid="import-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void doImport(f);
              e.target.value = "";
            }}
          />
          {!resetOpen ? (
            <Button variant="ghost" onClick={() => setResetOpen(true)} data-testid="reset-progress">
              Сбросить прогресс
            </Button>
          ) : (
            <span className="flex flex-wrap items-center gap-2 rounded-lg bg-warn-soft px-3 py-1.5 text-sm">
              Удалить весь прогресс{auth.user ? " (и в облаке)" : ""}?
              <Button size="sm" variant="danger" onClick={doReset} data-testid="reset-confirm">
                Да, сбросить
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setResetOpen(false)}>
                Отмена
              </Button>
            </span>
          )}
        </div>
        {ioMsg && (
          <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${ioMsg.kind === "ok" ? "bg-ok-soft text-ok" : "bg-bad-soft text-bad"}`} data-testid="io-message">
            {ioMsg.text}
          </p>
        )}
      </Section>

      {auth.enabled && auth.user && (
        <>
          <Section title="Смена пароля">
            <ChangePassword />
          </Section>
          <Section title="Удаление аккаунта">
            <p className="mb-3 text-sm text-muted">Удаляет аккаунт и все облачные данные. Прогресс в этом браузере тоже будет очищен.</p>
            <DeleteAccount />
          </Section>
        </>
      )}
    </div>
  );
}
