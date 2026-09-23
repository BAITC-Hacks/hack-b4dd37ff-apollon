"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { RunView } from "@/lib/contracts/api";
import type { Recommendation } from "@/lib/contracts/engine";
import { SkuDetailBody } from "./sku-detail";
import { api, ErrorNotice, LoadingState, PageHeading } from "./workspace";

interface Loaded { runId: string; run?: RunView; error?: string }

export function SkuPage({ runId, code }: { runId: string; code: string }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded>();
  useEffect(() => {
    let active = true;
    api<{ run: RunView }>(`/api/runs/${encodeURIComponent(runId)}`)
      .then(r => { if (active) setLoaded({ runId, run: r.run }); })
      .catch(e => { if (active) setLoaded({ runId, error: e instanceof Error ? e.message : "Не удалось открыть расчёт" }); });
    return () => { active = false; };
  }, [runId]);
  const current = loaded?.runId === runId ? loaded : undefined;
  const loading = !current;
  const run = current?.run;
  const rec: Recommendation | undefined = run?.result.recommendations.find(r => r.key === code);
  return <>
    <Link className="back-link" href="/plan"><ChevronLeft size={15} /> К плану закупок</Link>
    <PageHeading eyebrow="Объяснимый расчёт" title={rec ? rec.name : "Позиция"} description={rec ? `${rec.supplierArticle || rec.code} · ${rec.category ? `категория ${rec.category}` : "без категории"}` : "Загружаем позицию расчёта…"} />
    <ErrorNotice error={current?.error} />
    {loading ? <LoadingState /> : !run ? null : !rec ? <div className="empty-state"><h2>Позиция не найдена</h2><p>Она отсутствует в этом расчёте — возможно, была отфильтрована или расчёт устарел.</p></div> : <SkuDetailBody rec={rec} runId={run.id} datasetId={run.datasetId} onScenario={newRunId => { localStorage.setItem(`apollon.run.${run.datasetId}`, newRunId); router.push("/plan"); }} />}
  </>;
}
