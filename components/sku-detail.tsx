"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowUpRight, History, RotateCcw, TriangleAlert } from "lucide-react";
import type { Recommendation } from "@/lib/contracts/engine";
import { DemandChart, StockChart } from "./charts";
import { api, dateLabel, ErrorNotice, num, supplierLabel } from "./workspace";

const urgencyLabels = { CRITICAL: "Критично", HIGH: "Высокий", NORMAL: "Планово" };
const confidenceLabels = { high: "Высокая", medium: "Средняя", low: "Низкая" };

/** Formula decomposition + chart + anomalies + delivery timeline, built strictly from the recommendation's provenance. Shared by the drawer and the standalone drill-down page. */
export function SkuDetailBody({ rec, runId, datasetId, onScenario }: { rec: Recommendation; runId: string; datasetId: string; onScenario?: (newRunId: string) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const p = rec.provenance;
  async function restore(anomalyId: string) {
    setBusy(anomalyId); setError("");
    try {
      const result = await api<{ run: { id: string } }>("/api/runs", { method: "POST", body: JSON.stringify({ datasetId, baseRunId: runId, policy: { restoredAnomalyIds: [anomalyId] } }) });
      localStorage.setItem(`apollon.run.${datasetId}`, result.run.id);
      onScenario?.(result.run.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось пересчитать"); }
    finally { setBusy(""); }
  }
  return <div className="sku-detail">
    <ErrorNotice error={error} />
    <div className="metrics" style={{ gridTemplateColumns: "repeat(4,minmax(0,1fr))" }}>
      <div className="metric"><span>Рекомендация AI</span><strong>{num(rec.quantity)} {rec.unit}</strong><small>Кратность {p.multiple || 1} · MOQ {num(p.moq)}</small></div>
      <div className="metric"><span>Срочность</span><strong><span className={`badge ${rec.urgency}`}>{urgencyLabels[rec.urgency]}</span></strong><small>{rec.coverDays == null ? "Запас неизвестен" : `Запаса на ${num(rec.coverDays, 1)} дн.`}</small></div>
      <div className="metric"><span>Уверенность</span><strong><span className={`badge ${rec.confidence}-confidence`}>{confidenceLabels[rec.confidence]}</span></strong><small>{rec.needsReview ? "Требует проверки" : "Данных достаточно"}</small></div>
      <div className="metric"><span>Остаток / В пути</span><strong>{num(p.availableStock, 1)} / {num(p.eligibleInbound, 1)}</strong><small>{p.stockKind !== "current" ? `Оценка на ${dateLabel(p.stockDate)}` : `На ${dateLabel(p.stockDate)}`}</small></div>
    </div>
    <section className="card"><header className="card-header"><div><h2>Как рассчитано количество</h2><p>Разложение формулы строго из данных этого расчёта.</p></div></header><div className="card-body">
      <div className="formula">
        <div><strong>{num(p.forecastDemand, 1)}</strong><small>прогноз спроса, {rec.unit}</small></div><span>+</span>
        <div><strong>{num(p.safetyStock, 1)}</strong><small>страховой запас</small></div><span>−</span>
        <div><strong>{num(p.availableStock, 1)}</strong><small>своб. остаток</small></div><span>−</span>
        <div><strong>{num(p.eligibleInbound, 1)}</strong><small>в пути (≤{p.horizonDays} дн)</small></div><span>=</span>
        <div><strong>{num(p.rawNeed, 1)}</strong><small>чистая потребность</small></div><span>→</span>
        <div className="result"><strong>{num(rec.quantity)}</strong><small>к заказу (кратность/MOQ)</small></div>
      </div>
      <p className="explanation">{rec.explanation}</p>
      {p.assumptions.length > 0 && <details className="advanced-policy"><summary className="subtle-summary">Допущения расчёта · {p.assumptions.length}</summary>{p.assumptions.map((a, i) => <p className="chart-caption" key={i}>{a}</p>)}</details>}
      {rec.warnings.length > 0 && <div className="notice warning" style={{ marginTop: 14 }}>{rec.warnings.map((w, i) => <p key={i}>{w}</p>)}</div>}
      <div className="detail-list" style={{ marginTop: 18 }}>
        <div><dt>Сезонность (по месяцам)</dt><dd>×{p.seasonalFactors.map(f => f.toFixed(2)).join(" ×")}</dd></div>
        <div><dt>Рост спроса, год</dt><dd>{p.annualGrowth >= 0 ? "+" : ""}{num(p.annualGrowth * 100, 1)}% ({p.growthSource})</dd></div>
        <div><dt>Уровень сервиса</dt><dd>{num(p.serviceLevel * 100, 1)}%</dd></div>
        <div><dt>Упущенный спрос (оценка)</dt><dd>{num(p.lostDemand, 1)} [{num(p.lostDemandLow, 1)}–{num(p.lostDemandHigh, 1)}]</dd></div>
        <div><dt>Исключено разовых заказов</dt><dd>{num(p.excludedQuantity, 1)} {rec.unit}</dd></div>
        <div><dt>ABC / XYZ</dt><dd>{rec.abc}{rec.xyz}</dd></div>
      </div>
    </div></section>
    <section className="card"><header className="card-header"><div><h2>История спроса и прогноз</h2><p>Сырые продажи, без разовых заказов, с компенсацией дефицита и прогноз. Затенение — периоды дефицита.</p></div></header><div className="card-body"><DemandChart history={rec.history} unit={rec.unit} /></div></section>
    <section className="card"><header className="card-header"><div><h2>Прогноз остатка и поставки</h2><p>Проекция остатка до конца горизонта с учётом заказанных поставок по ETA.</p></div></header><div className="card-body"><StockChart projection={rec.projection} unit={rec.unit} /></div></section>
    {rec.anomalies.length > 0 && <section className="card"><header className="card-header"><div><h2>Разовые заказы и аномалии</h2><p>Исключённые из регулярного спроса разовые заказы. Восстановление пересчитывает сценарий на базе этого расчёта.</p></div></header><div className="card-body">
      {rec.anomalies.map(a => <div className={`anomaly-row ${a.excluded ? "excluded" : ""}`} key={a.id}><div><TriangleAlert size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6, color: "var(--anomaly)" }} />Накладная {a.invoice || a.id} · {dateLabel(a.date)} · {num(a.quantity, 1)} {rec.unit} <span className="product-code">{a.reason}</span></div>{a.excluded && <button className="button small" disabled={!!busy} onClick={() => void restore(a.id)}>{busy === a.id ? <span className="spinner" /> : <RotateCcw size={12} />} Восстановить</button>}</div>)}
    </div></section>}
    {rec.projection.some(pt => pt.inbound > 0) && <section className="card"><header className="card-header"><div><h2>Товар в пути</h2><p>Ожидаемые поступления в пределах горизонта расчёта.</p></div></header><div className="card-body">
      {rec.projection.filter(pt => pt.inbound > 0).map((pt, i) => <div className="timeline-row" key={i}><span className="timeline-dot" /><strong>{dateLabel(pt.date)}</strong><span>+{num(pt.inbound, 1)} {rec.unit}</span></div>)}
    </div></section>}
    <div className="notice"><History size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />Поставщик: <strong>{supplierLabel(rec.supplier)}</strong> · Код 1С {rec.code} · Артикул {rec.supplierArticle || "—"}. <Link className="text-link" href={`/plan/${runId}/sku/${encodeURIComponent(rec.key)}`}>Открыть на отдельной странице <ArrowUpRight size={13} /></Link></div>
  </div>;
}
