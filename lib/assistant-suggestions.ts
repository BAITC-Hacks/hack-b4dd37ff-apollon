import type { Recommendation } from "./contracts/engine";

/** Suggest questions about distinct SKUs within the first ten saved recommendations. */
export function suggestedQuestions(recommendations: Recommendation[]): string[] {
  const seen = new Set<string>();
  const firstTen = recommendations.slice(0, 10).filter(row => {
    const sku = `${row.supplier}:${row.code}`;
    if (seen.has(sku)) return false;
    seen.add(sku);
    return true;
  });
  const first = firstTen.find(row => row.quantity > 0) ?? firstTen[0];
  if (!first) return [];

  const remaining = firstTen.filter(row => row !== first);
  const review = remaining.find(row => row.needsReview || row.warnings.length > 0 || row.confidence === "low") ?? remaining[0];
  const lastChoices = remaining.filter(row => row !== review);
  const anomaly = lastChoices.find(row => row.anomalies.length > 0);
  const third = anomaly ?? lastChoices[0];
  const sku = (row: Recommendation) => `${row.supplier} ${row.code}`;

  return [
    first.quantity > 0 ? `Почему рекомендуется заказать ${sku(first)}?` : `Как рассчитана рекомендация для ${sku(first)}?`,
    review
      ? review.needsReview || review.warnings.length > 0 || review.confidence === "low"
        ? `Что проверить перед заказом ${sku(review)}?` : `Насколько надёжен расчёт по ${sku(review)}?`
      : "Какие проблемы есть в исходных данных?",
    third
      ? anomaly ? `Какие аномалии обнаружены у ${sku(third)}?` : `Как учтены остаток и поставки по ${sku(third)}?`
      : "Какие данные нужно проверить перед утверждением заказа?",
  ];
}
