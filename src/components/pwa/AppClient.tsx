"use client";
// Страница «Без интернета» (/app): скачивание всего курса для офлайна, установка курса как приложения (кнопка на
// Android и в Chrome/Edge, инструкция на iPhone) и совет войти в аккаунт, чтобы прогресс был общим на всех устройствах.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { APP_SHORT_NAME } from "@/lib/config";
import { clearOfflineCaches } from "@/lib/pwa/caches";
import { promptInstall, useInstall, useOnline, usePlatform, useStandalone } from "@/lib/pwa/client";
import {
  downloadCourse,
  fetchOfflineManifest,
  forgetOfflineRecord,
  listSavedPages,
  offlineSupported,
  readOfflineRecord,
  storageEstimate,
  type OfflineManifest,
  type OfflineProgress,
  type OfflineRecord,
  type OfflineResult,
} from "@/lib/pwa/offline";
import type { PlatformInfo } from "@/lib/pwa/platform";
import { ShareIcon } from "./PwaBanner";

const mb = (bytes: number) => `${Math.max(1, Math.round(bytes / 2 ** 20)).toLocaleString("ru-RU")} МБ`;

export function AppClient() {
  return (
    <div className="mt-8 space-y-6">
      <OfflineSection />
      <InstallSection />
      <AccountSection />
    </div>
  );
}

// ---------------------------------------------------------------- установка
function InstallSection() {
  const platform = usePlatform();
  const standalone = useStandalone();
  const { canPrompt, installed } = useInstall();
  const [declined, setDeclined] = useState(false);

  let body: React.ReactNode;
  if (!platform) body = <p className="text-muted">Определяем устройство…</p>;
  else if (standalone) body = <p className="text-ok">✓ Курс открыт как приложение.</p>;
  else if (installed)
    body = (
      <p className="text-ok">
        ✓ Приложение установлено — ищите иконку «{APP_SHORT_NAME}» на экране телефона или в списке приложений.
      </p>
    );
  else if (canPrompt)
    body = (
      <>
        <p>Браузер готов установить курс как приложение — с иконкой на экране и офлайн-режимом.</p>
        <button
          type="button"
          className="mt-3 rounded-md bg-accent px-4 py-2 font-semibold text-white dark:text-[#0f1726]"
          onClick={async () => setDeclined((await promptInstall()) === "dismissed")}
          data-testid="install-button"
        >
          Установить приложение
        </button>
      </>
    );
  else body = <InstallSteps platform={platform} />;

  return (
    <section className="paper p-5" data-testid="install-card">
      <h2 className="!m-0 font-display text-xl font-semibold">Установить как приложение</h2>
      <div className="mt-3 text-[0.97rem] leading-relaxed">{body}</div>
      {declined && <p className="mt-2 text-sm text-muted">Установку можно запустить позже из меню браузера.</p>}
    </section>
  );
}

function InstallSteps({ platform }: { platform: PlatformInfo }) {
  if (platform.os === "ios") {
    // iPad с iPadOS 13+ представляется компьютером Mac (detectPlatform узнаёт его по сенсорному экрану)
    const device = /iPad|Macintosh/.test(navigator.userAgent) ? "iPad" : "iPhone";
    return (
      <div data-testid="install-ios">
        {platform.browser !== "safari" && platform.browser !== "chrome" && (
          <p className="mb-2 text-sm text-muted">Удобнее всего — в Safari: откройте в нём этот сайт.</p>
        )}
        <ol className="list-decimal space-y-1.5 pl-5">
          <li>
            Нажмите «Поделиться» <ShareIcon /> —{" "}
            {platform.browser === "chrome" ? "справа в адресной строке Chrome" : "внизу экрана Safari (на iPad — вверху справа)"}.
          </li>
          <li>Пролистайте список и выберите «На экран „Домой“».</li>
          <li>Нажмите «Добавить» — на экране {device} появится иконка «{APP_SHORT_NAME}».</li>
        </ol>
        <p className="mt-3 text-sm text-muted">
          Нужна iOS 16.4 или новее для установки из Chrome; из Safari — любая современная iOS. Приложение хранит данные отдельно от
          Safari, поэтому лучше войти в аккаунт — подробнее ниже.
        </p>
      </div>
    );
  }
  if (platform.os === "android") {
    return (
      <div data-testid="install-android">
        <p>Откройте меню браузера (⋮ или ≡) и выберите «Установить приложение» или «Добавить на главный экран».</p>
        <p className="mt-2 text-sm text-muted">
          Если такого пункта нет, откройте сайт в Chrome: там установка работает лучше всего.
        </p>
      </div>
    );
  }
  return (
    <div data-testid="install-desktop">
      <ul className="list-disc space-y-1.5 pl-5">
        <li>Chrome, Edge, Яндекс Браузер: значок установки справа в адресной строке или меню → «Установить приложение».</li>
        <li>Safari на Mac: меню «Файл» → «Добавить в Dock».</li>
        <li>Firefox устанавливать сайты как приложения не умеет, но офлайн-режим в нём работает.</li>
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- офлайн
type Job =
  | { kind: "idle" }
  | { kind: "running"; progress: OfflineProgress }
  | { kind: "done"; result: OfflineResult }
  | { kind: "error"; message: string };

/** Что уже сохранено на устройстве (читается из кэшей и localStorage). */
interface Saved {
  supported: boolean;
  record: OfflineRecord | null;
  pages: number;
  usage: number | null;
}

async function readSaved(): Promise<Saved> {
  const [pages, est] = await Promise.all([listSavedPages(), storageEstimate()]);
  return { supported: offlineSupported(), record: readOfflineRecord(), pages: pages.length, usage: est?.usage ?? null };
}

function OfflineSection() {
  const online = useOnline();
  const [saved, setSaved] = useState<Saved | null>(null);
  const [version, setVersion] = useState(0); // увеличивается, чтобы перечитать сохранённое
  const [manifest, setManifest] = useState<OfflineManifest | null>(null);
  const [job, setJob] = useState<Job>({ kind: "idle" });
  const [confirmDelete, setConfirmDelete] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const refresh = () => setVersion((v) => v + 1);

  useEffect(() => {
    let active = true;
    readSaved().then((s) => active && setSaved(s));
    return () => {
      active = false;
    };
  }, [version]);

  useEffect(() => {
    if (!online || manifest) return;
    let active = true;
    fetchOfflineManifest()
      .then((m) => active && setManifest(m))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [online, manifest]);

  // не уходить со страницы посреди загрузки незаметно
  useEffect(() => {
    if (job.kind !== "running") return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [job.kind]);

  const start = async () => {
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setConfirmDelete(false);
    setJob({ kind: "running", progress: { phase: "prepare", done: 0, total: 0, bytes: 0, failed: 0 } });
    try {
      const m = manifest ?? (await fetchOfflineManifest());
      setManifest(m);
      const result = await downloadCourse(m, (progress) => setJob({ kind: "running", progress }), ctrl.signal);
      setJob({ kind: "done", result });
    } catch (e) {
      const err = e as Error;
      setJob({
        kind: "error",
        message:
          err?.name === "AbortError"
            ? "Загрузка остановлена. Уже скачанное сохранено — нажмите «Скачать курс», чтобы продолжить."
            : `Не получилось: ${err?.message || String(e)}`,
      });
    } finally {
      abortRef.current = null;
      refresh();
    }
  };

  const remove = async () => {
    await clearOfflineCaches();
    forgetOfflineRecord();
    setConfirmDelete(false);
    setJob({ kind: "idle" });
    refresh();
  };

  const running = job.kind === "running";
  const supported = saved ? saved.supported : null;
  const record = saved?.record ?? null;
  const savedPages = saved ? saved.pages : null;
  const usage = saved?.usage ?? null;
  const outdated = Boolean(record && manifest && record.version !== manifest.version);
  const complete = Boolean(record?.complete && !outdated);

  return (
    <section className="paper p-5" data-testid="offline-card">
      <h2 className="!m-0 font-display text-xl font-semibold">Скачать курс целиком</h2>
      {supported === false ? (
        <p className="mt-3">Этот браузер не поддерживает офлайн-режим. Он работает в Safari, Chrome, Edge, Firefox и Яндекс Браузере.</p>
      ) : (
        <>
          <p className="mt-3 text-[0.97rem] leading-relaxed">
            Уроки, которые вы открываете с интернетом, сохраняются на устройстве сами — вместе с Python, если запускали код. Чтобы
            заниматься без сети всем курсом (в поезде, на даче), скачайте его целиком: страницы, данные, Python и библиотеки
            {manifest ? ` — примерно ${mb(manifest.approxBytes)} на устройстве` : ""}. Лучше по Wi-Fi.
          </p>

          <div className="mt-4 rounded-md border border-dashed border-line-strong p-3 text-sm" data-testid="offline-status">
            {record ? (
              complete ? (
                <p className="text-ok">✓ Курс скачан целиком {new Date(record.at).toLocaleDateString("ru-RU")}.</p>
              ) : outdated ? (
                <p className="text-warn">Курс скачан для прошлой версии сайта — обновите офлайн-копию, чтобы получить исправления.</p>
              ) : (
                <p className="text-warn">Курс скачан не полностью — нажмите «Скачать курс», чтобы докачать.</p>
              )
            ) : (
              <p className="text-muted">Курс целиком ещё не скачан.</p>
            )}
            <p className="mt-1 text-muted">
              Сохранено страниц: {savedPages ?? "…"}
              {manifest ? ` из ${manifest.pages.length}` : ""}
              {usage !== null && usage > 0 ? ` · занято на устройстве: ${mb(usage)}` : ""}
            </p>
          </div>

          {job.kind === "running" && <ProgressBar progress={job.progress} />}
          {job.kind === "done" && (
            <div className="mt-3 text-sm" data-testid="offline-result" data-ok={job.result.ok ? "true" : "false"}>
              {job.result.ok ? (
                <p className="text-ok">✓ Готово: курс сохранён на устройстве и откроется без интернета.</p>
              ) : (
                <p className="text-warn">{job.result.message}</p>
              )}
              {job.result.persisted === false && (
                <p className="mt-1 text-muted">
                  Браузер может удалить сохранённое, если на устройстве кончится место. Установленное приложение хранит данные надёжнее.
                </p>
              )}
            </div>
          )}
          {job.kind === "error" && (
            <p className="mt-3 text-sm text-warn" data-testid="offline-error">
              {job.message}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {running ? (
              <button
                type="button"
                className="rounded-md border border-line-strong px-4 py-2 font-medium"
                onClick={() => abortRef.current?.abort()}
                data-testid="offline-cancel"
              >
                Остановить
              </button>
            ) : (
              <button
                type="button"
                className="rounded-md bg-accent px-4 py-2 font-semibold text-white disabled:opacity-50 dark:text-[#0f1726]"
                onClick={() => void start()}
                disabled={!online || supported !== true}
                data-testid="offline-download"
              >
                {complete ? "Проверить и докачать" : outdated ? "Обновить офлайн-копию" : "Скачать курс"}
              </button>
            )}
            {!running && (savedPages ?? 0) > 0 && (
              confirmDelete ? (
                <span className="flex flex-wrap items-center gap-2 text-sm">
                  Удалить всё сохранённое?
                  <button type="button" className="font-semibold text-bad underline" onClick={() => void remove()} data-testid="offline-delete-confirm">
                    Да, удалить
                  </button>
                  <button type="button" className="underline" onClick={() => setConfirmDelete(false)}>
                    Отмена
                  </button>
                </span>
              ) : (
                <button type="button" className="text-sm text-muted underline" onClick={() => setConfirmDelete(true)} data-testid="offline-delete">
                  Удалить офлайн-копию
                </button>
              )
            )}
          </div>
          {!online && <p className="mt-2 text-sm text-muted">Скачать курс можно, когда появится интернет.</p>}
        </>
      )}
    </section>
  );
}

function ProgressBar({ progress }: { progress: OfflineProgress }) {
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const label =
    progress.phase === "prepare"
      ? "Готовим список файлов…"
      : progress.phase === "python"
        ? "Загружаем библиотеки Python (seaborn, plotly)…"
        : progress.phase === "finish"
          ? "Завершаем…"
          : `Файлов: ${progress.done} из ${progress.total} · скачано ${mb(progress.bytes)}`;
  return (
    <div className="mt-3" data-testid="offline-progress" data-done={progress.done} data-total={progress.total}>
      <div
        className="h-2.5 overflow-hidden rounded-full bg-soft"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label="Скачивание курса"
      >
        <div className="h-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1.5 text-sm text-muted">
        {label}
        {progress.failed ? ` · не удалось: ${progress.failed}` : ""}
      </p>
    </div>
  );
}

// ---------------------------------------------------------------- аккаунт
function AccountSection() {
  const { enabled, user, username } = useAuth();
  return (
    <section className="paper p-5" data-testid="account-card">
      <h2 className="!m-0 font-display text-xl font-semibold">Прогресс на всех устройствах</h2>
      <div className="mt-3 space-y-2 text-[0.97rem] leading-relaxed">
        {enabled && user ? (
          <p>
            Вы вошли{username ? (
              <>
                {" "}как <b>{username}</b>
              </>
            ) : null}
            : прогресс хранится в облаке и одинаковый в браузере, в приложении и на других устройствах.
          </p>
        ) : (
          <p>
            Без входа прогресс хранится только в этом браузере. На iPhone и iPad приложение с экрана «Домой» хранит данные отдельно
            от Safari: решённое в Safari без входа в приложении не появится.{" "}
            {enabled && (
              <>
                <Link href="/login" className="font-semibold text-accent-ink underline">
                  Войдите в аккаунт
                </Link>{" "}
                — и прогресс будет общим везде.
              </>
            )}
          </p>
        )}
        <p className="text-sm text-muted">
          Без интернета решения сохраняются на устройстве и отправляются в облако, когда сеть появится. Ссылки из писем (подтверждение
          почты, новый пароль) открываются в браузере, а не в приложении — после них войдите в приложении заново.
        </p>
      </div>
    </section>
  );
}
