"use client";

import { useEffect, useMemo, useState } from "react";
import { TrendChart } from "./charts";
import { api, categoryLabel, ErrorNotice, LoadingState, PageHeading, supplierLabel, useWorkspace } from "./workspace";

interface TrendRow { supplier: string; category: string; unit: string; month: string; quantity: number }
interface Loaded { datasetId: string; rows?: TrendRow[]; error?: string }
const palette = ["#2c7294", "#6366F1", "#F59E0B", "#10B981", "#8B5CF6", "#0284C7", "#EF4444", "#215670"];

export function TrendsDashboard() {
  const { datasetId, dataset, loading: datasetLoading } = useWorkspace();
  const [loaded, setLoaded] = useState<Loaded>();
  const [group, setGroup] = useState<{ supplier: string; unit: string } | null>(null);
  useEffect(() => {
    if (!datasetId) return;
    const controller = new AbortController();
    api<{ trends: TrendRow[]; cutoffDate: string }>(`/api/trends?datasetId=${encodeURIComponent(datasetId)}`, { signal: controller.signal })
      .then(r => setLoaded({ datasetId, rows: r.trends }))
      .catch(e => { if (!controller.signal.aborted) setLoaded({ datasetId, error: e instanceof Error ? e.message : "Не удалось загрузить динамику" }); });
    return () => controller.abort();
  }, [datasetId]);
  const current = loaded?.datasetId === datasetId ? loaded : undefined;
  const loading = !!datasetId && !current;
  const rows = useMemo(() => current?.rows || [], [current]);
  const groups = useMemo(() => [...new Map(rows.map(r => [`${r.supplier}|${r.unit}`, { supplier: r.supplier, unit: r.unit }])).values()].sort((a, b) => a.supplier.localeCompare(b.supplier)), [rows]);
  const activeKey = `${group?.supplier}|${group?.unit}`;
  const active = groups.find(g => `${g.supplier}|${g.unit}` === activeKey) || groups[0];
  const categories = useMemo(() => active ? [...new Set(rows.filter(r => r.supplier === active.supplier && r.unit === active.unit).map(r => r.category))].sort() : [], [rows, active]);
  const chartData = useMemo(() => {
    if (!active) return [];
    const months = [...new Set(rows.filter(r => r.supplier === active.supplier && r.unit === active.unit).map(r => r.month))].sort();
    return months.map(month => { const point: Record<string, string | number> = { month }; for (const cat of categories) point[cat || "без категории"] = rows.find(r => r.supplier === active.supplier && r.unit === active.unit && r.category === cat && r.month === month)?.quantity ?? 0; return point; });
  }, [rows, active, categories]);
  if (datasetLoading) return <LoadingState />;
  return <>
    <PageHeading eyebrow="Категории и единицы измерения" title="Динамика спроса" description="Суммарный проданный объём по категориям и месяцам. Метры, штуки и комплекты никогда не суммируются в одну величину — каждая группа единиц измерения показана отдельно." />
    <ErrorNotice error={current?.error} />
    {loading ? <LoadingState text="Строим динамику…" /> : rows.length === 0 ? <div className="empty-state"><h2>Нет данных о продажах</h2><p>В наборе «{dataset?.name}» не найдено помесячных продаж для построения тренда.</p></div> : <>
      <div className="tab-bar" role="tablist" aria-label="Поставщик и единица измерения">{groups.map(g => <button key={`${g.supplier}-${g.unit}`} role="tab" aria-selected={active?.supplier === g.supplier && active?.unit === g.unit} className={active?.supplier === g.supplier && active?.unit === g.unit ? "active" : ""} onClick={() => setGroup(g)}>{supplierLabel(g.supplier)} · {g.unit || "ед."}</button>)}</div>
      <section className="card"><header className="card-header"><div><h2>{active ? `${supplierLabel(active.supplier)} · ${active.unit || "ед."}` : ""}</h2><p>Сумма проданного количества по категориям, помесячно.</p></div></header><div className="card-body"><TrendChart data={chartData} series={categories.map((c, i) => ({ key: c || "без категории", name: !c || c === "unknown" ? categoryLabel(c) : `Категория ${c}`, color: palette[i % palette.length] }))} /></div></section>
    </>}
  </>;
}
