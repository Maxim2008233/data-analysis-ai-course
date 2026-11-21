"use client";
import { useAuth } from "@/lib/auth/AuthProvider";

/** Уведомление после входа: «Перенесено N решённых задач». */
export function AuthNotice() {
  const { notice, clearNotice } = useAuth();
  if (!notice) return null;
  return (
    <div className="border-b border-line bg-ok-soft" role="status" data-testid="auth-notice">
      <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-2 text-sm text-ok sm:px-8">
        <span>✓ {notice}</span>
        <button className="ml-auto underline" onClick={clearNotice}>
          Закрыть
        </button>
      </div>
    </div>
  );
}
