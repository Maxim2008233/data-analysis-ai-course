"use client";
import { progressStore, useProgressItem } from "@/lib/progress/store";
import { lessonKey } from "@/lib/progress/stats";

/** Отметка «теория прочитана». */
export function TheoryReadButton({ lessonId }: { lessonId: string }) {
  const key = lessonKey(lessonId);
  const item = useProgressItem(key);
  const read = Boolean(item?.theoryRead);
  return (
    <div className="my-8 flex flex-wrap items-center gap-3 paper px-4 py-3">
      {read ? (
        <p className="text-sm text-ok" data-testid="theory-read">
          ✓ Теория отмечена как прочитанная
        </p>
      ) : (
        <>
          <p className="text-sm text-muted">Дочитали теорию? Отметьте — это попадёт в ваш прогресс.</p>
          <button
            type="button"
            className="rounded-lg bg-ok px-3 py-1.5 text-sm font-medium text-white dark:text-[#0e1a13] sm:ml-auto"
            onClick={() => progressStore.update(key, (p) => ({ ...p, theoryRead: true, theoryReadAt: Date.now() }))}
            data-testid="mark-theory-read"
          >
            Теория прочитана
          </button>
        </>
      )}
    </div>
  );
}
