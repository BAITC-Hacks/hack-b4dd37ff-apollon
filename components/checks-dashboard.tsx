"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle } from "lucide-react";
import { api, ErrorNotice, LoadingState, num, PageHeading, useWorkspace } from "./workspace";
import type { CaseCheck } from "@/lib/contracts/engine";

interface RealChecks { synthetic: boolean; rows: number; finiteQuantities: boolean; allExplained: boolean; flaggedAnomalies: number; productsWithEstimatedLostDemand: number; note: string }
interface Loaded { datasetId: string; checks?: CaseCheck[]; real?: RealChecks | null; error?: string }

export function ChecksDashboard() {
  const { datasetId, loading: datasetLoading } = useWorkspace();
  const [loaded, setLoaded] = useState<Loaded>();
  useEffect(() => {
    let active = true;
    api<{ checks: CaseCheck[]; realChecks: RealChecks | null }>("/api/checks", { method: "POST", body: JSON.stringify({ datasetId: datasetId || undefined }) })
      .then(r => { if (active) setLoaded({ datasetId, checks: r.checks, real: r.realChecks }); })
      .catch(e => { if (active) setLoaded({ datasetId, error: e instanceof Error ? e.message : "Не удалось выполнить проверки" }); });
    return () => { active = false; };
  }, [datasetId]);
  const current = loaded?.datasetId === datasetId ? loaded : undefined;
  const loading = !current;
  if (datasetLoading) return <LoadingState />;
  return <>
    <PageHeading eyebrow="Методология и доказательства" title="Проверки сценария" description="Пять обязательных условий кейса выполняются вживую на синтетической фикстуре и, при наличии активного набора, на реальных данных." />
    <ErrorNotice error={current?.error} />
    {loading ? <LoadingState text="Выполняем проверки…" /> : <>
      <section className="card"><header className="card-header"><div><h2>Синтетические доказательства</h2><p>Изолированная фикстура, не зависящая от загруженных данных.</p></div></header>
        {(current.checks || []).map(c => <div className="check-card" key={c.id}><div className={`check-icon ${c.passed ? "" : "failed"}`}>{c.passed ? <CheckCircle2 size={18} /> : <XCircle size={18} />}</div><div className="check-body"><h3>{c.name}</h3><p>{c.details}</p><div className="check-values">{Object.entries(c.values).map(([k, v]) => <span key={k}>{k}: {typeof v === "number" ? num(v, 2) : String(v)}</span>)}</div></div></div>)}
      </section>
      {current.real && <section className="card"><header className="card-header"><div><h2>Проверка на активном наборе</h2><p>{current.real.note}</p></div><span className={`badge ${current.real.synthetic ? "demo" : "teal"}`}>{current.real.synthetic ? "DEMO · синтетика" : "Загруженные данные"}</span></header><div className="card-body"><div className="detail-list">
        <div><dt>Строк расчёта</dt><dd>{num(current.real.rows)}</dd></div>
        <div><dt>Все количества конечны и неотрицательны</dt><dd>{current.real.finiteQuantities ? "Да" : "Нет"}</dd></div>
        <div><dt>У всех строк есть объяснение</dt><dd>{current.real.allExplained ? "Да" : "Нет"}</dd></div>
        <div><dt>Обнаружено разовых аномалий</dt><dd>{num(current.real.flaggedAnomalies)}</dd></div>
        <div><dt>Позиций с оценкой упущенного спроса</dt><dd>{num(current.real.productsWithEstimatedLostDemand)}</dd></div>
      </div></div></section>}
    </>}
  </>;
}
