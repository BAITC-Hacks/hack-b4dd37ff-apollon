"use client";

import { useMemo, useState } from "react";
import { PlayCircle } from "lucide-react";
import { api, EmptyState, ErrorNotice, LoadingState, num, PageHeading, supplierLabel, useWorkspace } from "./workspace";
import type { BacktestResult } from "@/lib/contracts/engine";

export function BacktestDashboard() {
  const { datasetId, dataset, loading: datasetLoading } = useWorkspace();
  const [loaded, setLoaded] = useState<{ datasetId: string; result: BacktestResult }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run() {
    if (!datasetId) return; setBusy(true); setError("");
    try { const r = await api<{ backtest: BacktestResult }>("/api/backtest", { method: "POST", body: JSON.stringify({ datasetId }) }); setLoaded({ datasetId, result: r.backtest }); }
    catch (e) { setError(e instanceof Error ? e.message : "Не удалось выполнить исторический тест"); }
    finally { setBusy(false); }
  }
  const result = loaded?.datasetId === datasetId ? loaded.result : undefined;
  const ran = !!result;
  const bySupplierHorizon = useMemo(() => {
    if (!result) return [];
    const groups = new Map<string, { supplier: string; horizon: number; unit: string; errors: number[]; count: number }>();
    for (const row of result.rows) {
      const key = `${row.supplier}|${row.horizon}|${row.unit}`;
      const g = groups.get(key) ?? { supplier: row.supplier, horizon: row.horizon, unit: row.unit, errors: [], count: 0 };
      g.errors.push(Math.abs(row.predicted - row.actual)); g.count++; groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => a.supplier.localeCompare(b.supplier) || a.horizon - b.horizon || a.unit.localeCompare(b.unit)).map(g => ({ ...g, mae: g.errors.reduce((s, v) => s + v, 0) / g.errors.length }));
  }, [result]);
  const horizons = useMemo(() => result ? [...new Set(result.metrics.map(m => m.horizon))].sort((a, b) => a - b) : [], [result]);
  if (datasetLoading) return <LoadingState />;
  return <>
    <PageHeading eyebrow="Историческая проверка прогноза" title="Бэктест" description="Хронологические точки отсчёта май–июль 2026 с переобучением очистки, сезонности и тренда на каждом срезе; сравнение с сезонным наивным и средним за 12 месяцев по каждому горизонту и единице измерения."><button className="button primary" disabled={!datasetId || busy} onClick={() => void run()}>{busy ? <span className="spinner" /> : <PlayCircle size={15} />} Запустить бэктест</button></PageHeading>
    <ErrorNotice error={error} />
    {!datasetId ? <EmptyState /> : !ran ? <div className="empty-state"><h2>Запустите проверку</h2><p>Расчёт переобучается на каждой точке отсчёта для набора «{dataset?.name}» и не использует будущие данные.</p></div> : busy ? <LoadingState text="Переобучаем модель на исторических точках…" /> : result && <>
      {result.warnings.length > 0 && <details className="notice warning"><summary>Допущения бэктеста · {result.warnings.length}</summary>{result.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
      {horizons.map(h => <section className="card" key={h}><header className="card-header"><div><h2>Горизонт {h} мес.</h2><p>Модель против сезонного наивного и среднего за 12 месяцев, по единицам измерения (единицы не суммируются).</p></div></header>
        <div className="table-scroll"><table><thead><tr><th>Модель</th><th>Ед.</th><th className="number">MAE</th><th className="number">WAPE</th><th className="number">Смещение</th><th className="number">n</th></tr></thead><tbody>{result.metrics.filter(m => m.horizon === h).map(m => <tr key={`${m.model}-${m.horizon}-${m.unit}`}><td>{m.model}</td><td>{m.unit || "—"}</td><td className="number">{num(m.mae, 2)}</td><td className="number">{m.wape === null ? "—" : `${num(m.wape * 100, 1)}%`}</td><td className="number">{num(m.bias, 2)}</td><td className="number">{num(m.count)}</td></tr>)}</tbody></table></div>
      </section>)}
      {horizons.length === 0 && <div className="notice">Нет полностью наблюдённых целевых месяцев для оценки метрик.</div>}
      <section className="card"><header className="card-header"><div><h2>По поставщику, горизонту и единице</h2><p>MAE модели с разбивкой, исключающей смешение штук и метров.</p></div></header>
        <div className="table-scroll"><table><thead><tr><th>Поставщик</th><th className="number">Горизонт, мес.</th><th>Ед.</th><th className="number">MAE</th><th className="number">n</th></tr></thead><tbody>{bySupplierHorizon.map(g => <tr key={`${g.supplier}-${g.horizon}-${g.unit}`}><td>{supplierLabel(g.supplier)}</td><td className="number">{g.horizon}</td><td>{g.unit || "—"}</td><td className="number">{num(g.mae, 2)}</td><td className="number">{num(g.count)}</td></tr>)}{bySupplierHorizon.length === 0 && <tr><td colSpan={5} style={{ textAlign: "center", padding: 20 }}>Нет полностью наблюдённых целевых месяцев</td></tr>}</tbody></table></div>
      </section>
    </>}
  </>;
}
