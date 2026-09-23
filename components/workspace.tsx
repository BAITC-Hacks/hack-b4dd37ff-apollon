"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, Sparkles, X } from "lucide-react";
import type { DatasetSummary } from "@/lib/contracts/api";
import type { ImportIssue, SourceFile, SourceRef } from "@/lib/contracts/engine";

export interface DatasetDetails {
  name: string; synthetic: boolean; cutoffDate: string; files: SourceFile[];
  suppliers: { supplier: string; productCount: number; transactionCount: number; categories: string[]; categoryCoverage?: { specified: number; missing: number }; issues: ImportIssue[]; seasonality: number[] }[];
}
interface WorkspaceState {
  datasets: DatasetSummary[]; datasetId: string; dataset?: DatasetSummary; details?: DatasetDetails;
  loading: boolean; error: string; selectDataset: (id: string) => void; refresh: (selectedId?: string) => Promise<void>;
}
const WorkspaceContext = createContext<WorkspaceState | null>(null);
export function useWorkspace() { const value = useContext(WorkspaceContext); if (!value) throw new Error("Workspace provider missing"); return value; }
export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...options, headers: { ...(options?.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...options?.headers } });
  const result = await response.json().catch(() => ({ error: `Ошибка сервера (${response.status})` }));
  if (!response.ok) throw new Error(result.error || `Ошибка запроса (${response.status})`);
  return result as T;
}
export const num = (value: number | null | undefined, digits = 0) => value == null || !Number.isFinite(value) ? "—" : new Intl.NumberFormat("ru-RU", { maximumFractionDigits: digits }).format(value);
export const dateLabel = (value: string) => new Date(value).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Almaty" });
export const supplierLabel = (supplier: string) => supplier === "SE" ? "Systeme Electric" : supplier;
export const categoryLabel = (category: string | null | undefined) => !category || category === "unknown" ? "Не указана в источнике" : category;
export function sourceLabel(source?: SourceRef & { cell?: string; workbookId?: string }) {
  if (!source) return "Источник не указан";
  return [source.file, source.sheet, source.cell || (source.row ? `строка ${source.row}` : "")].filter(Boolean).join(" · ");
}
export function ErrorNotice({ error }: { error?: string }) { return error ? <div className="notice danger" role="alert">{error}</div> : null; }
export function PageHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>;
}
export function LoadingState({ text = "Загружаем данные…" }: { text?: string }) { return <div className="loading-state" role="status"><span className="spinner"/>{text}</div>; }
export function Metric({ label, value, detail, tone = "" }: { label: string; value: ReactNode; detail?: string; tone?: string }) { return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }

/** Data-only workspace provider: no sidebar/topbar chrome. The single-page workspace (components/order-workspace.tsx) owns all layout and navigation. */
export function Workspace({ children }: { children: ReactNode }) {
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [detailsState, setDetailsState] = useState<{ datasetId: string; details: DatasetDetails }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // The URL (components/order-workspace.tsx) decides which dataset is active; the provider only loads data for it.
  const selectDataset = useCallback((id: string) => setDatasetId(id), []);
  const refresh = useCallback(async (selectedId?: string) => {
    setLoading(true); setError("");
    try {
      const result = await api<{ datasets: DatasetSummary[] }>("/api/datasets");
      setDatasets(result.datasets);
      if (selectedId) setDatasetId(selectedId);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить наборы"); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    api<{ datasets: DatasetSummary[] }>("/api/datasets", { signal: controller.signal })
      .then(result => setDatasets(result.datasets))
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Не удалось загрузить наборы"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, []);
  useEffect(() => {
    if (!datasetId) return;
    const controller = new AbortController();
    api<DatasetDetails>(`/api/datasets/${encodeURIComponent(datasetId)}`, { signal: controller.signal }).then(details => setDetailsState({ datasetId, details })).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [datasetId]);
  const dataset = datasets.find(d => d.id === datasetId);
  const details = detailsState?.datasetId === datasetId ? detailsState.details : undefined;
  return <WorkspaceContext.Provider value={{ datasets, datasetId, dataset, details, loading, error, selectDataset, refresh }}>
    <a href="#main" className="skip-link">Перейти к содержимому</a>
    <main id="main" className="single-page">{children}</main>
  </WorkspaceContext.Provider>;
}

export function Copilot({ runId }: { runId?: string }) {
  const { datasetId } = useWorkspace();
  const [open, setOpen] = useState(false); const [configured, setConfigured] = useState<boolean | null>(null);
  const [input, setInput] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const [messages, setMessages] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  useEffect(() => { api<{ copilotConfigured: boolean }>("/api/health").then(r => setConfigured(r.copilotConfigured)).catch(() => setConfigured(false)); }, []);
  async function send() {
    if (!input.trim() || busy || !datasetId) return;
    const message = input.trim(); setInput(""); setError(""); setBusy(true); setMessages(m => [...m, { role: "user", text: message }, { role: "assistant", text: "" }]);
    try {
      const response = await fetch("/api/agent", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, datasetId, runId }) });
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Ассистент недоступен"); }
      if (!response.body) throw new Error("Пустой ответ ассистента");
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let text = "";
      while (true) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value, { stream: true }); const content = text; setMessages(m => [...m.slice(0, -1), { role: "assistant", text: content }]); }
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка ассистента"); }
    finally { setBusy(false); }
  }
  if (!datasetId) return null;
  return <><button className="copilot-launcher" onClick={() => setOpen(true)}><Sparkles size={18}/> Помощник по закупкам</button>{open && <section className="copilot-panel" aria-label="Помощник по закупкам"><header><div><Sparkles size={20}/><strong>Apollon Copilot</strong></div><button className="icon-button" aria-label="Закрыть помощника" onClick={() => setOpen(false)}><X size={19}/></button></header><div className="copilot-body"><div className="copilot-intro">Помогу разобрать расчёт, проверить аномалии и сравнить сценарии. Утверждение заказа остаётся за вами.</div>{configured === false && <div className="notice">Ассистент не подключён. Для его работы требуется серверный OPENAI_API_KEY. Расчёты и утверждение доступны без ключа.</div>}{messages.map((m, i) => <div className={`chat-message ${m.role}`} key={i}><small>{m.role === "user" ? "Вы" : "Apollon"}</small><p>{m.text || (busy ? "Анализирую данные…" : "Ответ не получен")}</p></div>)}<ErrorNotice error={error}/></div><form onSubmit={e => { e.preventDefault(); void send(); }}><label className="sr-only" htmlFor="copilot-question">Вопрос ассистенту</label><textarea id="copilot-question" placeholder="Почему этой позиции нужен заказ?" value={input} onChange={e => setInput(e.target.value)} disabled={!configured || busy || !datasetId}/><button className="button primary" disabled={!configured || busy || !input.trim() || !datasetId}>{busy ? "Анализ…" : "Отправить"}<ArrowUpRight size={15}/></button></form></section>}</>;
}
