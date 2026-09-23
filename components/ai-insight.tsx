"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { api } from "./workspace";

// Settled summaries survive remounts (tab switches, reopening a dialog) for the life of the page.
const settled = new Map<string, { summary?: string; error?: string }>();

/** Blue "Кратко" block: POSTs `body` to `url` and renders the returned summary as labelled lines ("Метка: текст"). Never blocks the content below. */
export function AiInsight({ url, body }: { url: string; body: Record<string, string> }) {
  const requestKey = `${url}|${JSON.stringify(body)}`;
  const [state, setState] = useState<{ key: string; summary?: string; error?: string }>();
  const cached = settled.get(requestKey);
  const current = cached ? { key: requestKey, ...cached } : state?.key === requestKey ? state : undefined;
  useEffect(() => {
    if (settled.has(requestKey)) return;
    const controller = new AbortController();
    api<{ summary: string }>(url, { method: "POST", body: JSON.stringify(body), signal: controller.signal })
      .then(r => { settled.set(requestKey, { summary: r.summary }); setState({ key: requestKey, summary: r.summary }); })
      .catch(e => { if (!controller.signal.aborted) setState({ key: requestKey, error: e instanceof Error ? e.message : "Резюме недоступно" }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);
  return <section className="ai-summary" aria-live="polite" aria-busy={!current}>
    <div className="ai-summary-head"><Sparkles size={14} aria-hidden="true"/><strong>Кратко</strong><span>сгенерировано ИИ · проверьте по данным ниже</span></div>
    {!current ? <div className="ai-summary-loading"><span/><span/><span/><em className="sr-only">Готовим резюме…</em></div>
      : current.summary ? <div className="ai-summary-lines">{current.summary.split(/\n+/).map(line => line.trim()).filter(Boolean).map((line, i) => { const m = line.match(/^([^:]{2,24}):\s*(.*)$/); return <p key={i}>{m ? <><b>{m[1]}:</b> {m[2]}</> : line}</p>; })}</div>
      : <p className="ai-summary-error">{current.error}</p>}
  </section>;
}
