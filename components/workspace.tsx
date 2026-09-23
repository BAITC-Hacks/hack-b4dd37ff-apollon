"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ArrowUpRight, BarChart3, CheckCheck, CircleHelp, Database, Layers3, LayoutDashboard, Menu, PanelLeftClose, Sparkles, Upload, X } from "lucide-react";
import type { DatasetSummary } from "@/lib/contracts/api";
import type { ImportIssue, SourceFile } from "@/lib/contracts/engine";

export interface DatasetDetails {
  name: string; synthetic: boolean; cutoffDate: string; files: SourceFile[];
  suppliers: { supplier: string; productCount: number; transactionCount: number; categories: string[]; issues: ImportIssue[]; seasonality: number[] }[];
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
export function ErrorNotice({ error }: { error?: string }) { return error ? <div className="notice danger" role="alert">{error}</div> : null; }
export function PageHeading({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div><div className="heading-actions">{children}</div></div>;
}
export function EmptyState({ title = "Начнём с данных", description = "Загрузите отчёты поставщиков или откройте демонстрационный набор, чтобы рассчитать потребность." }: { title?: string; description?: string }) {
  return <div className="empty-state"><div className="empty-icon"><Layers3 size={30}/></div><h2>{title}</h2><p>{description}</p><Link className="button primary" href="/import">Перейти к данным <ArrowUpRight size={16}/></Link></div>;
}
export function LoadingState({ text = "Загружаем данные…" }: { text?: string }) { return <div className="loading-state" role="status"><span className="spinner"/>{text}</div>; }
export function Metric({ label, value, detail, tone = "" }: { label: string; value: ReactNode; detail?: string; tone?: string }) { return <div className={`metric ${tone}`}><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }

const links = [
  { href: "/", label: "Дашборд", icon: LayoutDashboard },
  { href: "/plan", label: "Расчёт заказов", icon: Sparkles },
  { href: "/data", label: "Данные", icon: Database },
  { href: "/checks", label: "Проверки", icon: CheckCheck },
  { href: "/backtest", label: "Бэктест", icon: Layers3 },
  { href: "/trends", label: "Тренды", icon: BarChart3 },
];
function isActive(pathname: string, href: string) { return href === "/" ? pathname === "/" : pathname.startsWith(href); }

export function Workspace({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [datasets, setDatasets] = useState<DatasetSummary[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [details, setDetails] = useState<DatasetDetails>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mobileOpen, setMobileOpen] = useState(false);
  const selectDataset = useCallback((id: string) => { setDatasetId(id); localStorage.setItem("apollon.dataset", id); }, []);
  const refresh = useCallback(async (selectedId?: string) => {
    setLoading(true); setError("");
    try {
      const result = await api<{ datasets: DatasetSummary[] }>("/api/datasets");
      setDatasets(result.datasets);
      const preferred = selectedId || localStorage.getItem("apollon.dataset");
      selectDataset(result.datasets.find(d => d.id === preferred)?.id || result.datasets[0]?.id || "");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось загрузить наборы"); }
    finally { setLoading(false); }
  }, [selectDataset]);
  useEffect(() => {
    const controller = new AbortController();
    api<{ datasets: DatasetSummary[] }>("/api/datasets", { signal: controller.signal })
      .then(result => {
        setDatasets(result.datasets);
        const preferred = localStorage.getItem("apollon.dataset");
        selectDataset(result.datasets.find(d => d.id === preferred)?.id || result.datasets[0]?.id || "");
      })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Не удалось загрузить наборы"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [selectDataset]);
  useEffect(() => {
    if (!datasetId) return;
    const controller = new AbortController();
    api<DatasetDetails>(`/api/datasets/${encodeURIComponent(datasetId)}`, { signal: controller.signal }).then(setDetails).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [datasetId]);
  const dataset = datasets.find(d => d.id === datasetId);
  return <WorkspaceContext.Provider value={{ datasets, datasetId, dataset, details, loading, error, selectDataset, refresh }}>
    <a href="#main" className="skip-link">Перейти к содержимому</a>
    {mobileOpen && <button className="sidebar-backdrop" aria-label="Закрыть навигацию" onClick={() => setMobileOpen(false)}/>}
    <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
      <Link className="brand" href="/plan" onClick={() => setMobileOpen(false)}><span className="brand-mark">A<span/></span><span>apollon<small>INTELLIGENT PROCUREMENT</small></span></Link>
      <div className="sidebar-workspace"><span className="workspace-avatar">ЭК</span><div><strong>Электрокомплект</strong><small>Закупки · Алматы</small></div><PanelLeftClose size={16}/></div>
      <div className="nav-caption">РАБОЧЕЕ ПРОСТРАНСТВО</div>
      <nav aria-label="Основная навигация">{links.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`nav-link ${isActive(pathname, href) ? "active" : ""}`} aria-current={isActive(pathname, href) ? "page" : undefined}><Icon size={19}/>{label}{href === "/plan" && <span className="nav-dot"/>}</Link>)}</nav>
      <div className="sidebar-bottom"><div className="sidebar-note"><Sparkles size={20}/><strong>Решения с обоснованием</strong><p>От истории спроса до заказа. Каждый расчёт можно проверить.</p></div><Link href="/checks" className="sidebar-help"><CircleHelp size={17}/> Методология и проверки <ArrowUpRight size={15}/></Link><div className="sidebar-foot">APOLLON <span>·</span> PROCUREMENT INTELLIGENCE</div></div>
    </aside>
    <div className="workspace-main"><header className="topbar"><div className="topbar-breadcrumb"><button className="icon-button mobile-menu" aria-label="Открыть навигацию" onClick={() => setMobileOpen(true)}><Menu size={20}/></button><span>Рабочее пространство</span><span className="slash">/</span><strong>{links.find(l => isActive(pathname, l.href))?.label || "Обзор"}</strong></div><div className="topbar-right"><span className="warehouse-label"><span className="status-dot"/> Алматы</span><div className="user-avatar" title="Менеджер закупок">МЗ</div></div></header>
      <div className="dataset-bar"><div className="dataset-select"><Database size={15}/><label className="sr-only" htmlFor="dataset-select">Активный набор данных</label><select id="dataset-select" value={datasetId} onChange={e => selectDataset(e.target.value)} disabled={loading || !datasets.length}>{!datasets.length && <option value="">Нет загруженных данных</option>}{datasets.map(d => <option value={d.id} key={d.id}>{d.name}</option>)}</select>{dataset?.synthetic && <span className="badge demo">DEMO · СИНТЕТИКА</span>}</div><span className="dataset-date">{dataset ? `Данные на ${dateLabel(dataset.cutoffDate)}` : "Ваши данные — основа точного заказа"}</span><Link href="/import" className="text-link"><Upload size={14}/> Загрузить</Link></div>
      <main id="main" className="main-content"><ErrorNotice error={error}/>{children}</main><footer className="main-footer"><span>Apollon · Прозрачное планирование закупок</span><span>Заказы утверждает ответственный сотрудник</span></footer>
    </div>
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
  return <><button className="copilot-launcher" onClick={() => setOpen(true)}><Sparkles size={18}/> Помощник по закупкам</button>{open && <section className="copilot-panel" aria-label="Помощник по закупкам"><header><div><Sparkles size={20}/><strong>Apollon Copilot</strong></div><button className="icon-button" aria-label="Закрыть помощника" onClick={() => setOpen(false)}><X size={19}/></button></header><div className="copilot-body"><div className="copilot-intro">Помогу разобрать расчёт, проверить аномалии и сравнить сценарии. Утверждение заказа остаётся за вами.</div>{configured === false && <div className="notice">Ассистент не подключён. Для его работы требуется серверный OPENAI_API_KEY. Расчёты и утверждение доступны без ключа.</div>}{messages.map((m, i) => <div className={`chat-message ${m.role}`} key={i}><small>{m.role === "user" ? "Вы" : "Apollon"}</small><p>{m.text || (busy ? "Анализирую данные…" : "Ответ не получен")}</p></div>)}<ErrorNotice error={error}/></div><form onSubmit={e => { e.preventDefault(); void send(); }}><label className="sr-only" htmlFor="copilot-question">Вопрос ассистенту</label><textarea id="copilot-question" placeholder="Почему этой позиции нужен заказ?" value={input} onChange={e => setInput(e.target.value)} disabled={!configured || busy || !datasetId}/><button className="button primary" disabled={!configured || busy || !input.trim() || !datasetId}>{busy ? "Анализ…" : "Отправить"}<ArrowUpRight size={15}/></button></form></section>}</>;
}
