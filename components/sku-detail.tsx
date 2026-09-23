"use client";

import { useEffect, useState } from "react";
import { RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import type { Recommendation } from "@/lib/contracts/engine";
import { DemandChart, StockChart } from "./charts";
import { api, dateLabel, ErrorNotice, num } from "./workspace";

const urgencyLabels = { CRITICAL: "Критично", HIGH: "Высокий", NORMAL: "Планово" };
const confidenceLabels = { high: "Высокая", medium: "Средняя", low: "Низкая" };
const abcLabels: Record<string, string> = { A: "80% оборота", B: "следующие 15%", C: "последние 5%" };
const xyzLabels: Record<string, string> = { X: "стабильный спрос", Y: "колеблющийся", Z: "нерегулярный" };
const MONTHS = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];

/** Splits the engine's one-paragraph explanation into sentences (a period followed by a capital letter), without touching decimals. */
function explanationSteps(text: string) {
  return text.split(/(?<=\.)\s+(?=[А-ЯЁA-Z])/).map(s => s.trim()).filter(Boolean);
}

/** Plain-language summary from the OpenAI Agents SDK (POST /api/runs/[id]/summary). The calculation below never depends on it. */
function AiSummary({ runId, recKey }: { runId: string; recKey: string }) {
  const [state, setState] = useState<{ key: string; summary?: string; error?: string }>();
  const current = state?.key === `${runId}:${recKey}` ? state : undefined;
  useEffect(() => {
    const key = `${runId}:${recKey}`, controller = new AbortController();
    api<{ summary: string }>(`/api/runs/${encodeURIComponent(runId)}/summary`, { method: "POST", body: JSON.stringify({ key: recKey }), signal: controller.signal })
      .then(r => setState({ key, summary: r.summary }))
      .catch(e => { if (!controller.signal.aborted) setState({ key, error: e instanceof Error ? e.message : "Резюме недоступно" }); });
    return () => controller.abort();
  }, [runId, recKey]);
  return <section className="ai-summary" aria-live="polite" aria-busy={!current}>
    <header><Sparkles size={14} aria-hidden="true"/><strong>Кратко</strong><span>сгенерировано ИИ · проверьте по расчёту ниже</span></header>
    {!current ? <div className="ai-summary-loading"><span/><span/><span/><em className="sr-only">Готовим резюме…</em></div>
      : current.summary ? <div className="ai-summary-lines">{current.summary.split(/\n+/).map(line => line.trim()).filter(Boolean).map((line, i) => { const m = line.match(/^([^:]{2,20}):\s*(.*)$/); return <p key={i}>{m ? <><b>{m[1]}:</b> {m[2]}</> : line}</p>; })}</div> : <p className="ai-summary-error">{current.error}</p>}
  </section>;
}

function SeasonalityBars({ factors }: { factors: number[] }) {
  const max = Math.max(1.2, ...factors);
  return <div className="season-bars" role="img" aria-label={`Коэффициенты сезонности: ${factors.map((f, i) => `${MONTHS[i]} ×${f.toFixed(2)}`).join(", ")}`}>
    {factors.map((f, i) => <div key={i} className={`season-bar ${f >= 1 ? "up" : "down"}`}>
      <span className="season-value">×{f.toFixed(2)}</span>
      <div className="season-track" style={{ "--base": `${(1 / max) * 100}%` } as React.CSSProperties}><span style={{ height: `${Math.max(2, (f / max) * 100)}%` }}/></div>
      <span className="season-month">{MONTHS[i]}</span>
    </div>)}
  </div>;
}

/** Formula decomposition + chart + anomalies + delivery timeline, built strictly from the recommendation's provenance. Rendered inside the single-page workspace's product detail drawer. */
export function SkuDetailBody({ rec, runId, datasetId, onScenario }: { rec: Recommendation; runId: string; datasetId: string; onScenario?: (newRunId: string) => void }) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const p = rec.provenance;
  async function restore(anomalyId: string) {
    setBusy(anomalyId); setError("");
    try {
      const result = await api<{ run: { id: string } }>("/api/runs", { method: "POST", body: JSON.stringify({ datasetId, baseRunId: runId, policy: { restoredAnomalyIds: [anomalyId] } }) });
      onScenario?.(result.run.id);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось пересчитать"); }
    finally { setBusy(""); }
  }
  const steps = explanationSteps(rec.explanation);
  return <div className="sku-detail">
    <ErrorNotice error={error} />
    <AiSummary runId={runId} recKey={rec.key}/>
    <div className="drawer-kpis">
      <div className="drawer-kpi accent"><span>Рекомендовано</span><strong>{num(rec.quantity)} <small>{rec.unit}</small></strong><em>Кратность {num(p.multiple || 1)} · MOQ {num(p.moq)}</em></div>
      <div className="drawer-kpi"><span>Срочность</span><strong><span className={`badge ${rec.urgency}`}>{urgencyLabels[rec.urgency]}</span></strong><em>{rec.coverDays == null ? "Запас неизвестен" : `Запаса хватит на ${num(rec.coverDays, 1)} дн.`}</em></div>
      <div className="drawer-kpi"><span>Уверенность прогноза</span><strong><span className={`badge ${rec.confidence}-confidence`}>{confidenceLabels[rec.confidence]}</span></strong><em>{rec.needsReview ? "Требует проверки менеджером" : "Проверка не требуется"}</em></div>
      <div className="drawer-kpi"><span>Остаток / в пути</span><strong>{num(p.availableStock, 1)} / {num(p.eligibleInbound, 1)} <small>{rec.unit}</small></strong><em>{p.stockKind === "current" ? "Фактический остаток" : "Оценка остатка"} на {dateLabel(p.stockDate)}</em></div>
    </div>

    <section className="card"><header className="card-header"><div><h2>Как рассчитано количество</h2><p>Все числа взяты из этого расчёта. Горизонт — {p.horizonDays} дней (срок поставки + период обзора).</p></div></header><div className="card-body">
      <ol className="formula-steps">
        <li><span className="formula-sign" aria-hidden="true"></span><div><strong>Прогноз спроса на {p.horizonDays} дн.</strong><small>с учётом сезонности и роста</small></div><b>{num(p.forecastDemand, 1)}</b></li>
        <li><span className="formula-sign" aria-hidden="true">+</span><div><strong>Страховой запас</strong><small>уровень сервиса {num(p.serviceLevel * 100, 1)}%</small></div><b>{num(p.safetyStock, 1)}</b></li>
        <li><span className="formula-sign" aria-hidden="true">−</span><div><strong>Свободный остаток</strong><small>{p.stockKind === "current" ? "фактический" : "оценка"}, {dateLabel(p.stockDate)}</small></div><b>{num(p.availableStock, 1)}</b></li>
        <li><span className="formula-sign" aria-hidden="true">−</span><div><strong>Товар в пути</strong><small>поставки с ETA в пределах {p.horizonDays} дн.</small></div><b>{num(p.eligibleInbound, 1)}</b></li>
        <li className="subtotal"><span className="formula-sign" aria-hidden="true">=</span><div><strong>Чистая потребность</strong></div><b>{num(p.rawNeed, 1)}</b></li>
        <li className="total"><span className="formula-sign" aria-hidden="true">→</span><div><strong>К заказу</strong><small>округлено до MOQ {num(p.moq)} и кратности {num(p.multiple || 1)}</small></div><b>{num(rec.quantity)} {rec.unit}</b></li>
      </ol>
      <h3 className="drawer-subtitle">Обоснование</h3>
      <ul className="explanation-steps">{steps.map((line, i) => <li key={i}>{line}</li>)}</ul>
      {rec.warnings.length > 0 && <div className="notice warning" style={{ marginTop: 14 }}><strong>Предупреждения</strong><ul className="explanation-steps">{rec.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul></div>}
      {p.assumptions.length > 0 && <details className="advanced-policy"><summary className="subtle-summary">Допущения расчёта ({p.assumptions.length})</summary><ul className="explanation-steps">{p.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul></details>}
    </div></section>

    <section className="card"><header className="card-header"><div><h2>Сезонность</h2><p>Во сколько раз спрос месяца выше (&gt;1) или ниже (&lt;1) среднего месяца. Коэффициент умножает базовый спрос {num(p.baseMonthlyDemand, 1)} {rec.unit}/мес.</p></div></header><div className="card-body">
      <SeasonalityBars factors={p.seasonalFactors}/>
      <p className="chart-caption">Как получено: по истории продаж этого товара (продажи месяца ÷ среднемесячные продажи того же года, всплески ограничены 4× типичного месяца) и по медианному профилю всех товаров поставщика в той же единице. Чем больше полных лет истории, тем больше вес собственного профиля. Средний коэффициент = 1.</p>
    </div></section>

    <section className="card"><header className="card-header"><div><h2>Прочие параметры</h2></div></header><div className="card-body">
      <dl className="detail-list">
        <div><dt>Рост спроса, % в год</dt><dd>{p.annualGrowth >= 0 ? "+" : ""}{num(p.annualGrowth * 100, 1)}%<small>{p.growthSource}</small></dd></div>
        <div><dt>Уровень сервиса</dt><dd>{num(p.serviceLevel * 100, 1)}%<small>вероятность не уйти в дефицит</small></dd></div>
        <div><dt>Упущенный спрос</dt><dd>{num(p.lostDemand, 1)} {rec.unit}<small>диапазон {num(p.lostDemandLow, 1)}–{num(p.lostDemandHigh, 1)}</small></dd></div>
        <div><dt>Исключено разовых заказов</dt><dd>{num(p.excludedQuantity, 1)} {rec.unit}</dd></div>
        <div><dt>ABC / XYZ</dt><dd>{rec.abc} / {rec.xyz}<small>{abcLabels[rec.abc]} · {xyzLabels[rec.xyz]}</small></dd></div>
      </dl>
    </div></section>

    <section className="card"><header className="card-header"><div><h2>История спроса и прогноз</h2><p>Сырые продажи, без разовых заказов, с компенсацией дефицита и прогноз. Затенение — периоды дефицита.</p></div></header><div className="card-body"><DemandChart history={rec.history} unit={rec.unit} /></div></section>
    <section className="card"><header className="card-header"><div><h2>Прогноз остатка и поставки</h2><p>Проекция остатка до конца горизонта с учётом заказанных поставок по ETA.</p></div></header><div className="card-body"><StockChart projection={rec.projection} unit={rec.unit} /></div></section>
    {rec.anomalies.length > 0 && <section className="card"><header className="card-header"><div><h2>Разовые заказы и аномалии</h2><p>Исключённые из регулярного спроса разовые заказы. Восстановление пересчитывает сценарий на базе этого расчёта.</p></div></header><div className="card-body">
      {rec.anomalies.map(a => <div className={`anomaly-row ${a.excluded ? "excluded" : ""}`} key={a.id}><div><TriangleAlert size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6, color: "var(--anomaly)" }} />Накладная {a.invoice || a.id} · {dateLabel(a.date)} · {num(a.quantity, 1)} {rec.unit} <span className="product-code">{a.reason}</span></div>{a.excluded && <button className="button small" disabled={!!busy} onClick={() => void restore(a.id)}>{busy === a.id ? <span className="spinner" /> : <RotateCcw size={12} />} Восстановить</button>}</div>)}
    </div></section>}
    {rec.projection.some(pt => pt.inbound > 0) && <section className="card"><header className="card-header"><div><h2>Товар в пути</h2><p>Ожидаемые поступления в пределах горизонта расчёта.</p></div></header><div className="card-body">
      {rec.projection.filter(pt => pt.inbound > 0).map((pt, i) => <div className="timeline-row" key={i}><span className="timeline-dot" /><strong>{dateLabel(pt.date)}</strong><span>+{num(pt.inbound, 1)} {rec.unit}</span></div>)}
    </div></section>}
  </div>;
}
