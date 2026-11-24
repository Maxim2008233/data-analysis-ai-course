// Строка «Столбцы» под условием задания (рисуется на сервере): какие столбцы данных нужны и что в них лежит —
// «`Year` — год выпуска · `Price(euro)` — цена, евро» или для матрицы NumPy «Столбцы `X`: `0` — `Year`, год выпуска».
// Столбцы находит src/lib/content/columns.ts по эталонному решению, описания — content/columns.yaml.
import type { TaskColumns } from "@/lib/content/columns";

export function TaskColumnsLine({ columns }: { columns: TaskColumns }) {
  return (
    <p className="md mt-3 rounded-md border border-dashed border-line-strong bg-soft/40 px-3 py-2 text-sm leading-relaxed" data-testid="task-columns">
      <span className="font-semibold">
        {columns.matrix ? (
          <>
            Столбцы <code>{columns.matrix}</code>:
          </>
        ) : (
          "Столбцы:"
        )}
      </span>{" "}
      {columns.items.map((it, i) => (
        <span key={`${it.index ?? ""}-${it.name}`} data-column={it.name}>
          {i > 0 && " · "}
          {it.index !== undefined ? (
            <>
              <code>{it.index}</code> — <code>{it.name}</code>
              {it.label ? `, ${it.label}` : ""}
            </>
          ) : (
            <>
              <code>{it.name}</code>
              {it.label ? ` — ${it.label}` : ""}
            </>
          )}
        </span>
      ))}
    </p>
  );
}
