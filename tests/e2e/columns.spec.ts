// Строка «Столбцы» под условием задания: какие столбцы нужны и что в них (src/lib/content/columns.ts).
import { test, expect, openTask } from "./helpers";

test("37. Под условием задания — нужные столбцы: номера столбцов X в NumPy и точные названия в Pandas", async ({ page }) => {
  // NumPy (задание 1.3.3): в условии «год» и «цена», номера столбцов матрицы X — в строке «Столбцы»
  let card = await openTask(page, "m1-l3-t3");
  let line = card.getByTestId("task-columns");
  await expect(line).toBeVisible();
  await expect(line).toContainText("Столбцы X:");
  await expect(line).toContainText("0 — Year, год выпуска");
  await expect(line).toContainText("3 — Price(euro), цена, евро");

  // Pandas (задание 2.5.3): точные названия столбцов с описаниями
  card = await openTask(page, "m2-l5-t3");
  line = card.getByTestId("task-columns");
  await expect(line).toBeVisible();
  await expect(line).toContainText("Year — год выпуска");
  await expect(line).toContainText("Distance — пробег, км");

  // задание без таблиц (Python без данных) — строки нет
  card = await openTask(page, "m0-l4-t5");
  await expect(card.getByTestId("task-columns")).toHaveCount(0);
});
