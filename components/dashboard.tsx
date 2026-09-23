"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Database, Play } from "lucide-react";
import type { RunView } from "@/lib/contracts/api";
import { api, dateLabel, EmptyState, ErrorNotice, LoadingState, Metric, num, PageHeading, supplierLabel, useWorkspace } from "./workspace";

const urgencyLabels = { CRITICAL: "Критично", HIGH: "Высокий", NORMAL: "Планово" };
interface Loaded { datasetId: string; run?: RunView; error?: string }

export function Dashboard() {
  const { datasetId, dataset, loading: datasetLoading } = useWorkspace();
  const [loaded, setLoaded] = useState<Loaded>();
  useEffect(() => {
    if (!datasetId) return;
    let active = true;
    api<{ runs: { id: string }[] }>(`/api/runs?datasetId=${encodeURIComponent(datasetId)}`)
      .then(r => { const id = r.runs[0]?.id; return id ? api<{ run: RunView }>(`/api/runs/${encodeURIComponent(id)}`) : null; })
      .then(r => { if (active) setLoaded({ datasetId, run: r?.run }); })
      .catch(e => { if (active) setLoaded({ datasetId, error: e instanceof Error ? e.message : "Не удалось загрузить дашборд" }); });
    return () => { active = false; };
  }, [datasetId]);
  const current = loaded?.datasetId === datasetId ? loaded : undefined;
  const loading = !!datasetId && !current;
  const run = current?.run;
  const recs = useMemo(() => run?.result.recommendations || [], [run]);
  const critical = useMemo(() => recs.filter(r => r.urgency === "CRITICAL").sort((a, b) => (a.coverDays ?? -1) - (b.coverDays ?? -1)).slice(0, 10), [recs]);
  const needsOrder = recs.filter(r => run?.orders.find(o => o.supplier === r.supplier)?.quantities[r.key] ?? r.quantity).length;
  const approved = run?.orders.reduce((n, o) => n + o.approvedKeys.length, 0) || 0;

  if (datasetLoading) return <LoadingState />;
  return <>
    <div className="dashboard-hero"><div><h2>ТОО «Электрокомплект» · Отдел закупа</h2><p>Автоматический расчёт потребности в пополнении склада по данным IEK и Systeme Electric: история продаж, сезонность, устойчивый рост, остатки, товары в пути и разовые заказы.</p></div>{datasetId && <Link className="button primary" href="/plan"><Play size={14} /> К расчёту заказов <ArrowRight size={14} /></Link>}</div>
    <PageHeading eyebrow="Обзор" title="Дашборд закупок" description={dataset ? `Активный набор: ${dataset.name} · данные на ${dateLabel(dataset.cutoffDate)}` : "Выберите или загрузите данные, чтобы увидеть обзор"} />
    <ErrorNotice error={current?.error} />
    {!datasetId ? <EmptyState /> : loading ? <LoadingState text="Собираем последний расчёт…" /> : !run ? <div className="empty-state"><div className="empty-icon"><Play size={25} /></div><h2>Расчётов пока нет</h2><p>Для набора «{dataset?.name}» ещё не выполнялся расчёт заказов.</p><Link className="button primary" href="/plan">Выполнить первый расчёт <ArrowRight size={15} /></Link></div> : <>
      <div className="metrics">
        <Metric label="Товаров в наборе" value={num(dataset?.productCount)} detail={`${new Set(recs.map(r => r.supplier)).size} поставщика`} tone="teal" />
        <Metric label="Позиций требуют заказа" value={num(needsOrder)} detail="После учёта остатков и поставок" />
        <Metric label="Критический дефицит" value={num(critical.length)} tone="red" detail="Риск дефицита до следующей поставки" />
        <Metric label="Утверждено позиций" value={num(approved)} tone="orange" detail={approved ? "Зафиксировано для экспорта" : "Ожидают решения менеджера"} />
      </div>
      {critical.length > 0 && <div className="kpi-alert">{critical.length} позиций в зоне критического риска — дефицит может наступить до прихода следующей поставки.</div>}
      <section className="card"><header className="card-header"><div><h2>Топ-10 критических позиций</h2><p>Отсортировано по остатку в днях. Открывается последний расчёт по активному набору.</p></div><Link className="button small" href="/plan">Все позиции</Link></header>
        <div className="table-scroll"><table><thead><tr><th>Наименование</th><th>Поставщик</th><th className="number">Запас, дн.</th><th className="number">Остаток</th><th className="number">К заказу</th><th>Срочность</th></tr></thead><tbody>
          {critical.map(r => <tr key={r.key}><td><Link className="product-name" href={`/plan/${run.id}/sku/${encodeURIComponent(r.key)}`}>{r.name}</Link><span className="product-code">{r.supplierArticle || r.code}</span></td><td>{supplierLabel(r.supplier)}</td><td className="number">{num(r.coverDays, 1)}</td><td className="number">{num(r.provenance.availableStock, 1)}</td><td className="number">{num(r.quantity)} {r.unit}</td><td><span className={`badge ${r.urgency}`}>{urgencyLabels[r.urgency]}</span></td></tr>)}
          {critical.length === 0 && <tr><td colSpan={6} style={{ textAlign: "center", padding: 25 }}>Критических позиций нет — риск дефицита под контролем</td></tr>}
        </tbody></table></div>
      </section>
    </>}
    <div className="notice"><Database size={14} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }} />Все показатели рассчитаны по последнему сохранённому расчёту активного набора данных. Смените набор в шапке, чтобы увидеть другой склад или демо.</div>
  </>;
}
