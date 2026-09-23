"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, ArrowUpDown, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight,
  Database, FileClock, FileSpreadsheet, FolderUp, History, Play, Save, Search,
  ShieldCheck, Sparkles, UploadCloud, X,
} from "lucide-react";
import type { DatasetSummary, OrderView, RunView } from "@/lib/contracts/api";
import { DEFAULT_POLICY, type Policy, type Recommendation } from "@/lib/contracts/engine";
import type { RunHistoryEntry } from "@/lib/repo/explorer";
import { routePath, type Route } from "@/lib/route";
import { SkuDetailBody } from "./sku-detail";
import { DataExplorer } from "./data-explorer";
import { ChecksDashboard } from "./checks-dashboard";
import { BacktestDashboard } from "./backtest-dashboard";
import { TrendsDashboard } from "./trends-dashboard";
import { api, categoryLabel, Copilot, dateLabel, ErrorNotice, LoadingState, Metric, num, supplierLabel, useWorkspace } from "./workspace";

type RunSummary = { id: string; createdAt: string; baseRunId: string | null };
type AuditEvent = { id: string; createdAt: string; action?: string; type?: string; actor?: string; payload?: unknown; details?: unknown };
const urgencyLabels = { CRITICAL: "Критично", HIGH: "Высокий", NORMAL: "Планово" };
const confidenceLabels = { high: "Высокая", medium: "Средняя", low: "Низкая" };

/** The six partner reports per supplier. `match` assigns dropped files to a slot by their file name. */
const UPLOAD_SLOTS = [
  { id: "sales", title: "Продажи по месяцам", hint: "Количество продаж за 2+ года", match: (n: string) => /продаж/i.test(n) && !/динамик/i.test(n) },
  { id: "stock", title: "Остатки по месяцам", hint: "Остаток на складе на конец месяца", match: (n: string) => /остат/i.test(n) },
  { id: "transit", title: "Товар в пути", hint: "Ожидаемые поставки и даты прихода", match: (n: string) => /пут[иь]|transit/i.test(n) },
  { id: "moq", title: "MOQ и кратность", hint: "Минимальная партия и кратность заказа", match: (n: string) => /moq|кратн/i.test(n) },
  { id: "dynamics", title: "Динамика продаж", hint: "Документы продаж: даты, количества", match: (n: string) => /динамик/i.test(n) },
  { id: "season", title: "Сезонность", hint: "Сезонные коэффициенты по месяцам", match: (n: string) => /сезон/i.test(n) },
] as const;
type SlotId = typeof UPLOAD_SLOTS[number]["id"];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PAGE_SIZE = 100;
const unitLabel = (unit: string) => unit === "unknown" ? "ед. не указана" : unit;

/**
 * Single-page procurement workspace: choose data -> validate -> calculate -> review -> adjust -> approve -> export.
 * Replaces the former sidebar-driven multi-page app (see UI_UX_REDESIGN_PROMPT.md).
 */
export function OrderWorkspace({ initialRoute, initialSku }: { initialRoute: Route; initialSku?: string }) {
  const { datasetId, dataset, datasets, details, loading: datasetsLoading, error: datasetError, selectDataset, refresh } = useWorkspace();

  // ---- URL: every workspace state has an address (/, /datasets/<id>, /runs/<id>, ?sku=<key>) ----
  const [route, setRoute] = useState<Route>(initialRoute);
  const navigate = useCallback((next: Route) => { window.history.pushState(null, "", routePath(next)); setRoute(next); setDrawerKeyState(undefined); }, []);
  useEffect(() => {
    const onPop = () => {
      const parts = window.location.pathname.split("/").filter(Boolean);
      setRoute(parts.length === 2 && (parts[0] === "datasets" || parts[0] === "runs") ? { kind: parts[0] === "datasets" ? "dataset" : "run", id: decodeURIComponent(parts[1]) } : { kind: "start" });
      setDrawerKeyState(new URLSearchParams(window.location.search).get("sku") || undefined);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  // ---- Data source (upload / case data) ----
  const [slots, setSlots] = useState<Partial<Record<SlotId, File>>>({});
  const [uploadName, setUploadName] = useState("");
  const [uploadSupplier, setUploadSupplier] = useState("");
  const [sourceBusy, setSourceBusy] = useState<"" | "upload" | "refresh">("");
  const [dragSlot, setDragSlot] = useState<SlotId | "all" | "">("");
  const [sourceError, setSourceError] = useState("");

  // ---- Calculation scope / policy ----
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  // Empty selection means "all suppliers".
  const [supplierScope, setSupplierScope] = useState<string[]>([]);

  // ---- Runs ----
  const [runsState, setRunsState] = useState<{ datasetId: string; runs: RunSummary[] }>({ datasetId: "", runs: [] });
  const runs = runsState.datasetId === datasetId ? runsState.runs : [];
  const [loadedRun, setRun] = useState<RunView>();
  // Only the run named by the URL is shown; a stale one stays hidden while the next one loads.
  const run = route.kind === "run" && loadedRun?.id === route.id ? loadedRun : undefined;
  const [failedRunId, setFailedRunId] = useState("");
  const runRef = useRef<{ id: string; datasetId: string } | undefined>(undefined);
  const runLoading = route.kind === "run" && loadedRun?.id !== route.id && failedRunId !== route.id;
  const [calcBusy, setCalcBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // ---- Table / review state ----
  const [query, setQuery] = useState(""); const [urgency, setUrgency] = useState(""); const [reviewOnly, setReviewOnly] = useState(false);
  const [sort, setSort] = useState<{ key: "name" | "quantity" | "urgency" | "coverDays"; direction: number }>({ key: "urgency", direction: 1 });
  const [page, setPage] = useState(0);
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [rowBusy, setRowBusy] = useState("");
  const [drawerKey, setDrawerKeyState] = useState<string | undefined>(initialSku);
  function setDrawerKey(key?: string) {
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("sku", key); else url.searchParams.delete("sku");
    window.history.replaceState(null, "", url.pathname + url.search);
    setDrawerKeyState(key);
  }
  const [audit, setAudit] = useState<{ supplier: string; events: AuditEvent[] }>();
  const [approval, setApproval] = useState<{ order: OrderView; keys?: string[] }>();
  const [approver, setApprover] = useState(""); const [acknowledged, setAcknowledged] = useState(false);

  // ---- Dialogs ----
  const [explorerOpen, setExplorerOpen] = useState(false);
  const [reviewDialogOpen, setReviewDialogOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<RunHistoryEntry[]>();
  const [historyError, setHistoryError] = useState("");
  const [confirmNewCalc, setConfirmNewCalc] = useState(false);

  const issues = useMemo(() => (details?.suppliers || []).flatMap(s => s.issues.map(i => ({ ...i, supplier: i.supplier || s.supplier }))), [details]);
  const blocking = issues.filter(i => i.severity === "error");
  const hasEdits = !!run && Object.keys(edits).length > 0;

  function addRun(forDataset: string, entry: RunSummary) {
    setRunsState(current => ({ datasetId: forDataset, runs: [entry, ...(current.datasetId === forDataset ? current.runs.filter(r => r.id !== entry.id) : [])] }));
  }
  function applyRun(loaded: RunView) {
    runRef.current = { id: loaded.id, datasetId: loaded.datasetId };
    setRun(loaded); setPolicy(loaded.result.policy);
    setEdits({}); setSelected([]); setPage(0);
  }

  // Route → state. A run URL loads that saved result (never recalculates); a dataset URL opens its calculation step.
  useEffect(() => {
    if (route.kind !== "run") { selectDataset(route.kind === "dataset" ? route.id : ""); return; }
    if (runRef.current?.id === route.id) { selectDataset(runRef.current.datasetId); return; }
    let active = true;
    const id = route.id;
    api<{ run: RunView }>(`/api/runs/${encodeURIComponent(id)}`)
      .then(loaded => { if (active) { applyRun(loaded.run); selectDataset(loaded.run.datasetId); } })
      .catch(e => { if (active) { setFailedRunId(id); setError(e instanceof Error ? e.message : "Не удалось открыть расчёт"); } });
    return () => { active = false; };
  }, [route, selectDataset]);

  // Saved runs of the active dataset (for the run switcher and "open last calculation").
  useEffect(() => {
    if (!datasetId) return;
    let active = true;
    api<{ runs: RunSummary[] }>(`/api/runs?datasetId=${encodeURIComponent(datasetId)}`)
      .then(result => { if (active) setRunsState({ datasetId, runs: result.runs }); })
      .catch(() => { if (active) setRunsState({ datasetId, runs: [] }); });
    return () => { active = false; };
  }, [datasetId]);

  function updatePolicy<K extends keyof Policy>(key: K, value: Policy[K]) { setPolicy(p => ({ ...p, [key]: value })); }

  async function refreshData() {
    setSourceBusy("refresh"); setSourceError("");
    try { await refresh(); }
    catch (e) { setSourceError(e instanceof Error ? e.message : "Не удалось обновить список данных"); }
    finally { setSourceBusy(""); }
  }

  async function importData() {
    setSourceBusy("upload"); setSourceError(""); setSuccess("");
    try {
      const body = new FormData(); Object.values(slots).forEach(file => file && body.append("files", file));
      if (uploadName.trim()) body.append("name", uploadName.trim());
      if (uploadSupplier) body.append("supplier", uploadSupplier);
      const result = await api<{ dataset: DatasetSummary }>("/api/import", { method: "POST", body });
      await refresh();
      setSlots({}); setUploadName(""); setUploadSupplier("");
      navigate({ kind: "dataset", id: result.dataset.id });
      setSuccess(`«${result.dataset.name}» загружен. Проверьте сводку данных ниже и запустите расчёт.`);
    } catch (e) { setSourceError(e instanceof Error ? e.message : "Не удалось загрузить данные"); }
    finally { setSourceBusy(""); }
  }

  // Opens a saved run without recalculating: the URL change loads it.
  function openRun(id: string, notice?: string) {
    setError(""); setSuccess(notice || "");
    navigate({ kind: "run", id });
  }

  async function calculate() {
    if (!datasetId || calcBusy) return;
    setCalcBusy(true); setError(""); setSuccess("");
    try {
      const result = await api<{ run: RunView }>("/api/runs", { method: "POST", body: JSON.stringify({ datasetId, policy, ...(supplierScope.length ? { suppliers: supplierScope } : {}) }) });
      applyRun(result.run);
      addRun(result.run.datasetId, { id: result.run.id, createdAt: result.run.createdAt, baseRunId: null });
      navigate({ kind: "run", id: result.run.id });
      setSuccess("Расчёт готов. Проверьте рекомендации перед утверждением.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка расчёта"); }
    finally { setCalcBusy(false); }
  }

  const recommendations = useMemo(() => run?.result.recommendations || [], [run]);
  function quantity(r: Recommendation) { return run?.orders.find(o => o.supplier === r.supplier)?.quantities[r.key] ?? r.quantity; }
  const filtered = useMemo(() => {
    const ranks = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
    return recommendations.filter(r => (!urgency || r.urgency === urgency) && (!reviewOnly || r.needsReview) && (!query || `${r.name} ${r.code} ${r.supplierArticle}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => {
      // Rows that need manual review always go after the confident ones, whatever the chosen sort.
      if (a.needsReview !== b.needsReview) return a.needsReview ? 1 : -1;
      if (sort.key === "name") return a.name.localeCompare(b.name, "ru") * sort.direction;
      if (sort.key === "urgency") return (ranks[a.urgency] - ranks[b.urgency]) * sort.direction;
      return ((a[sort.key] ?? Infinity) - (b[sort.key] ?? Infinity)) * sort.direction;
    });
  }, [recommendations, urgency, reviewOnly, query, sort]);
  const reviewCount = useMemo(() => recommendations.filter(r => r.needsReview).length, [recommendations]);
  const urgencyCounts = useMemo(() => { const counts = { CRITICAL: 0, HIGH: 0, NORMAL: 0 }; for (const r of recommendations) counts[r.urgency]++; return counts; }, [recommendations]);
  const pageSize = PAGE_SIZE; const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); const activePage = Math.min(page, pageCount - 1); const visible = filtered.slice(activePage * pageSize, (activePage + 1) * pageSize);
  function toggleSort(key: typeof sort.key) { setSort(s => ({ key, direction: s.key === key ? -s.direction : 1 })); }
  function toggleKey(key: string) { setSelected(s => s.includes(key) ? s.filter(k => k !== key) : [...s, key]); }
  function updateOrder(order: OrderView) { setRun(r => r ? { ...r, orders: r.orders.map(o => o.id === order.id ? order : o) } : r); }

  async function saveEdits(order: OrderView) {
    const orderEdits = Object.entries(edits).filter(([key]) => key in order.quantities).map(([key, value]) => ({ key, quantity: Number(value) }));
    if (orderEdits.some(e => !Number.isFinite(e.quantity) || e.quantity < 0 || edits[e.key].trim() === "")) { setError("Количество должно быть неотрицательным числом."); return; }
    setRowBusy(order.id); setError(""); setSuccess("");
    try {
      const result = await api<{ order: OrderView }>(`/api/orders/${order.id}`, { method: "PATCH", body: JSON.stringify({ expectedRevision: order.revision, edits: orderEdits }) });
      updateOrder(result.order);
      setEdits(current => Object.fromEntries(Object.entries(current).filter(([key]) => !(key in order.quantities))));
      setSuccess("Изменения сохранены. Для экспорта необходимо заново утвердить заказ.");
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось сохранить"); } finally { setRowBusy(""); }
  }
  async function saveAllEdits() {
    if (!run) return;
    for (const order of run.orders) { if (Object.keys(edits).some(k => k in order.quantities)) await saveEdits(order); }
  }
  async function approve() {
    if (!approval) return; setRowBusy("approve"); setError("");
    try {
      const result = await api<{ order: OrderView }>(`/api/orders/${approval.order.id}/approve`, { method: "POST", body: JSON.stringify({ expectedRevision: approval.order.revision, approver, acknowledgedEstimates: acknowledged, keys: approval.keys }) });
      updateOrder(result.order); setApproval(undefined); setSelected([]);
      setSuccess(`Заказ ${supplierLabel(result.order.supplier)} утверждён. Версия ${result.order.revision} зафиксирована для экспорта.`);
    } catch (e) { setError(e instanceof Error ? e.message : "Не удалось утвердить"); } finally { setRowBusy(""); }
  }
  async function download(order: OrderView, format: string) {
    setRowBusy(`export-${order.id}`); setError("");
    try {
      const response = await fetch(`/api/export?orderId=${order.id}&revision=${order.revision}&format=${format}`);
      if (!response.ok) { const result = await response.json(); throw new Error(result.error || "Ошибка экспорта"); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const anchor = document.createElement("a");
      anchor.href = url; anchor.download = `Apollon-${order.supplier}-v${order.revision}.${format === "email" ? "txt" : format}`; anchor.click(); URL.revokeObjectURL(url);
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка экспорта"); } finally { setRowBusy(""); }
  }
  async function showAudit(order: OrderView) { setError(""); try { const result = await api<{ events: AuditEvent[] }>(`/api/orders/${order.id}`); setAudit({ supplier: order.supplier, events: result.events }); } catch (e) { setError(e instanceof Error ? e.message : "Ошибка истории"); } }

  const approvedCount = run?.orders.reduce((n, o) => n + o.approvedKeys.length, 0) || 0;
  const draftOrders = run?.orders.filter(o => o.status !== "APPROVED") || [];
  const overallStatus = !run ? "" : run.orders.length === 0 ? "" : draftOrders.length === 0 ? "Все заказы утверждены" : approvedCount > 0 ? "Часть заказов утверждена" : "Черновик — не утверждён";

  function openHistory() {
    setHistoryOpen(true); setHistoryError("");
    api<{ history: RunHistoryEntry[] }>("/api/history").then(r => setHistory(r.history)).catch(e => setHistoryError(e instanceof Error ? e.message : "Не удалось загрузить историю"));
  }
  function openHistoryEntry(entry: RunHistoryEntry) {
    setHistoryOpen(false);
    openRun(entry.id);
  }

  function startNewCalculation() {
    if (hasEdits) { setConfirmNewCalc(true); return; }
    resetToSource();
  }
  function resetToSource() {
    setPolicy(DEFAULT_POLICY); setSupplierScope([]);
    setError(""); setSuccess(""); setConfirmNewCalc(false);
    navigate({ kind: "start" });
  }

  // ---- Upload slots ----
  function acceptFile(file: File): string {
    if (!/\.xlsx$/i.test(file.name) || file.name.startsWith("~$")) return `${file.name}: нужен файл Excel .xlsx`;
    if (file.size > MAX_FILE_BYTES) return `${file.name}: файл больше 20 МБ`;
    return "";
  }
  function putFile(slot: SlotId, file: File) {
    const problem = acceptFile(file);
    if (problem) { setSourceError(problem); return; }
    setSourceError(""); setSlots(current => ({ ...current, [slot]: file }));
  }
  /** Several files at once: each goes to the slot its name matches; unknown names are reported, never guessed. */
  function distributeFiles(list: File[]) {
    const next = { ...slots }; const problems: string[] = [];
    for (const file of list) {
      const problem = acceptFile(file);
      if (problem) { problems.push(problem); continue; }
      const slot = UPLOAD_SLOTS.find(s => s.match(file.name));
      if (slot) next[slot.id] = file; else problems.push(`${file.name}: не удалось определить тип отчёта — перетащите его в нужную ячейку`);
    }
    setSlots(next); setSourceError(problems.join("\n"));
  }


  const filledCount = UPLOAD_SLOTS.filter(slot => slots[slot.id]).length;
  const caseDatasets = datasets.filter(d => !d.synthetic);
  const onStart = route.kind === "start";

  return <div className="app-shell">
    <header className="app-header">
      <Link className="app-brand" href="/" onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); startNewCalculation(); }}>
        <Image src="/brand/ekt-logo-256.png" alt="" width={38} height={38} className="app-brand-logo"/>
        <div className="app-brand-text"><span>Решение соло-команды Apollon</span><small>закуп для ТОО «Электрокомплект»</small></div>
      </Link>
      <div className="app-header-actions">
        {!onStart && <button className="button" onClick={startNewCalculation}><Sparkles size={14} aria-hidden="true"/> Новый расчёт</button>}
        <button className="button" onClick={openHistory}><History size={14} aria-hidden="true"/> История расчётов</button>
      </div>
    </header>

    <ErrorNotice error={datasetError || error}/>
    {success && <div className="notice" role="status"><Check size={14} aria-hidden="true" style={{ display: "inline", verticalAlign: "-3px", marginRight: 7 }}/>{success}</div>}

    {onStart && <>
      <div className="page-heading no-margin"><div><h1>Рассчитайте заказ поставщику</h1><p>Загрузите свои отчёты или используйте подготовленные данные кейса.</p></div></div>
      <div className="source-cards">
        <section className="card upload-card" aria-labelledby="upload-title"
          onDragOver={e => { e.preventDefault(); if (!dragSlot) setDragSlot("all"); }}
          onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragSlot(""); }}
          onDrop={e => { e.preventDefault(); setDragSlot(""); distributeFiles(Array.from(e.dataTransfer.files)); }}>
          <header className="card-header"><div><h2 id="upload-title">Загрузить свои отчёты</h2><p>Шесть отчётов одного поставщика в формате .xlsx. Перетащите все файлы сразу — они распределятся по названию.</p></div><span className="badge">{filledCount} из 6</span></header>
          <div className="card-body">
            <div className={`upload-slots ${dragSlot === "all" ? "dragging" : ""}`}>
              {UPLOAD_SLOTS.map((slot, index) => { const file = slots[slot.id]; return <div key={slot.id}
                className={`upload-slot ${file ? "filled" : ""} ${dragSlot === slot.id ? "dragging" : ""}`}
                onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDragSlot(slot.id); }}
                onDrop={e => { e.preventDefault(); e.stopPropagation(); setDragSlot(""); const [first] = Array.from(e.dataTransfer.files); if (first) putFile(slot.id, first); }}>
                <span className="upload-slot-index" aria-hidden="true">{file ? <Check size={14}/> : index + 1}</span>
                <div className="upload-slot-text">
                  <strong>{slot.title}</strong>
                  {file ? <span className="upload-slot-file" title={file.name}><FileSpreadsheet size={13} aria-hidden="true"/>{file.name} · {num(file.size / 1024)} КБ</span> : <span>{slot.hint}</span>}
                </div>
                {file
                  ? <button type="button" className="icon-button" aria-label={`Убрать файл «${slot.title}»`} onClick={() => setSlots(current => { const next = { ...current }; delete next[slot.id]; return next; })}><X size={15}/></button>
                  : <label className="button small upload-slot-pick">Выбрать<input type="file" accept=".xlsx" className="sr-only" aria-label={`Файл: ${slot.title}`} onChange={e => { const f = e.target.files?.[0]; if (f) putFile(slot.id, f); e.target.value = ""; }}/></label>}
              </div>; })}
            </div>
            <div className="upload-bulk">
              <UploadCloud size={16} aria-hidden="true"/>
              <span>Перетащите файлы сюда или</span>
              <label className="upload-bulk-pick">выберите несколько<input type="file" accept=".xlsx" multiple className="sr-only" aria-label="Выбрать несколько отчётов" onChange={e => { distributeFiles(Array.from(e.target.files || [])); e.target.value = ""; }}/></label>
            </div>
            <div className="upload-fields">
              <label className="field"><span>Поставщик</span><select value={uploadSupplier} onChange={e => setUploadSupplier(e.target.value)}><option value="">Определить по названию файлов</option><option value="IEK">IEK</option><option value="SE">Systeme Electric</option></select></label>
              <label className="field"><span>Название набора</span><input value={uploadName} maxLength={120} onChange={e => setUploadName(e.target.value)} placeholder="Например, IEK сентябрь…" autoComplete="off"/></label>
            </div>
            {sourceError && <div className="notice danger" role="alert" style={{ whiteSpace: "pre-line" }}>{sourceError}</div>}
            <div className="upload-submit">
              <button className="button primary" disabled={!filledCount || !!sourceBusy} onClick={() => void importData()}>{sourceBusy === "upload" ? <span className="spinner"/> : <FolderUp size={15} aria-hidden="true"/>} {sourceBusy === "upload" ? "Импортируем и проверяем…" : "Загрузить и проверить"}</button>
              <span className="chart-caption">{filledCount === 0 ? "Добавьте хотя бы один отчёт." : filledCount < 6 ? `Не хватает ${6 - filledCount} из 6 — отсутствующие данные будут отмечены в проверке.` : "Все шесть отчётов на месте."}</span>
            </div>
          </div>
        </section>
        <section className="card demo-card" aria-labelledby="case-title"><div className="card-body">
          <div className="demo-symbol"><Database size={24} aria-hidden="true"/></div>
          <div className="eyebrow">Данные кейса</div>
          <h2 id="case-title">Использовать данные кейса</h2>
          <p>Отчёты IEK и Systeme Electric, сохранённые в PostgreSQL. Расчёт выполняется заново — готовых ответов нет.</p>
          {datasetsLoading ? <LoadingState text="Загружаем список наборов…"/> : caseDatasets.length === 0 ? <p className="chart-caption">Наборов для расчёта пока нет. Загрузите свои отчёты или обновите список.</p> : <div className="dataset-list">
            {caseDatasets.map(d => <div className="dataset-list-row" key={d.id}>
              <div style={{ minWidth: 0 }}><strong>{d.name}</strong>
                <div className="dataset-suppliers">{[...new Set(d.files.map(f => f.supplier).filter(Boolean))].map(s => <SupplierLogo key={s} supplier={String(s)} size="sm"/>)}</div>
                <div className="product-code">{num(d.productCount)} товаров · данные на {dateLabel(d.cutoffDate)} · загружено {dateLabel(d.createdAt)}</div>
              </div>
              <a className="button small" href={routePath({ kind: "dataset", id: d.id })} onClick={e => { if (e.metaKey || e.ctrlKey || e.shiftKey) return; e.preventDefault(); navigate({ kind: "dataset", id: d.id }); }}>Использовать <ArrowRight size={12} aria-hidden="true"/></a>
            </div>)}
          </div>}
          <button className="button" disabled={!!sourceBusy} onClick={() => void refreshData()}>{sourceBusy === "refresh" ? <span className="spinner"/> : <Database size={15} aria-hidden="true"/>} {sourceBusy === "refresh" ? "Обновляем список…" : "Обновить список"}</button>
        </div></section>
      </div>
    </>}

    {!onStart && !datasetId && (runLoading || route.kind === "dataset") && <LoadingState text={route.kind === "run" ? "Открываем сохранённый расчёт…" : "Загружаем данные…"}/>}
    {!onStart && !datasetId && !runLoading && route.kind === "run" && error && <p className="chart-caption procurement-hint"><button className="button" onClick={() => navigate({ kind: "start" })}>К выбору данных</button></p>}

    {!onStart && datasetId && <>
      <div className="page-heading procurement-heading">
        <div><h1>Заказ поставщику</h1><p>{dataset ? `${dataset.name} · данные на ${dateLabel(dataset.cutoffDate)}` : "Загружаем данные…"}{run && <> · <span className="route-id" title="Адрес этого расчёта">расчёт {run.id.slice(-8)}</span></>}</p></div>
        <details className="data-actions" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}><summary>Данные <ChevronDown size={14} aria-hidden="true"/></summary><div className="data-actions-menu">
          <button className="button" onClick={() => setExplorerOpen(true)}><Search size={14} aria-hidden="true"/>Просмотреть данные</button>
          <button className="button" onClick={startNewCalculation}><FolderUp size={14} aria-hidden="true"/>Изменить / загрузить отчёты</button>
          <button className="button" onClick={() => setReviewDialogOpen(true)}><ShieldCheck size={14} aria-hidden="true"/>Проверка расчёта</button>
        </div></details>
      </div>

      {datasetsLoading ? <LoadingState/> : <>
        <section className="card procurement-start">
          <div className="card-body">
            <div className="procurement-layout">
              <div className="procurement-scope">
                <ChipSelect label="Поставщики" allLabel="Все поставщики" options={(details?.suppliers || []).map(s => ({ value: s.supplier, label: <><SupplierLogo supplier={s.supplier} size="sm"/><span className="sr-only">{supplierLabel(s.supplier)}</span></> }))}
                  value={supplierScope} onChange={setSupplierScope}/>
                <button className="button primary" disabled={!datasetId || !details || calcBusy} onClick={() => void calculate()}>{calcBusy ? <span className="spinner"/> : <Play size={16} aria-hidden="true"/>} {calcBusy ? "Рассчитываем…" : run ? "Пересчитать заказ" : "Рассчитать заказ"}</button>
              </div>
              <section className="procurement-params" aria-labelledby="params-title">
                <h3 id="params-title">Параметры расчёта</h3>
                <p className="chart-caption">Изменение параметра требует пересчёта. Поиск и фильтры таблицы на расчёт не влияют.</p>
                <div className="params-grid">
                  <label className="field"><span>Срок поставки, дней</span><input type="number" min={1} max={365} value={policy.leadTimeDays} onChange={e => updatePolicy("leadTimeDays", Number(e.target.value))}/></label>
                  <label className="field"><span>Рост спроса, % / год</span><input type="number" min={-95} max={300} placeholder="Из данных" value={policy.growthRate === null ? "" : Number((policy.growthRate * 100).toFixed(2))} onChange={e => updatePolicy("growthRate", e.target.value === "" ? null : Number(e.target.value) / 100)}/></label>
                  <label className="field"><span>Минимальный запас, дней</span><input type="number" min={0} max={180} value={policy.safetyDays} onChange={e => updatePolicy("safetyDays", Number(e.target.value))}/></label>
                </div>
              </section>
            </div>
            {blocking.length > 0 && <p className="notice warning">В исходных данных есть ошибки. Перед утверждением проверьте отмеченные рекомендации. <button className="button small" onClick={() => setExplorerOpen(true)}>Просмотреть данные</button></p>}
          </div>
        </section>

        {runLoading ? <LoadingState text="Открываем сохранённый расчёт…"/> : !run ? null : <>
          <div className="metrics">
            <Metric label="Позиций в расчёте" value={num(recommendations.length)} detail={`${new Set(recommendations.map(r => r.supplier)).size} поставщика · ${dateLabel(run.result.cutoffDate)}`} tone="teal"/>
            <Metric label="Требуют заказа" value={num(recommendations.filter(r => quantity(r) > 0).length)} detail="Потребность после учёта остатков"/>
            <Metric label="Риск дефицита" value={num(recommendations.filter(r => r.urgency === "CRITICAL").length)} detail="Дефицит до следующей поставки" tone="red"/>
            <Metric label="Утверждено позиций" value={num(approvedCount)} detail={approvedCount ? "Зафиксированы для экспорта" : "Ожидают проверки менеджера"} tone="orange"/>
          </div>
          {run.scenarioDelta && (() => { const changed = run.scenarioDelta.filter(d => d.delta !== 0); const baseRunId = runs.find(r => r.id === run.id)?.baseRunId; return <details className="scenario-banner" open>
            <summary>Сценарий: изменилось {num(changed.length)} позиций относительно базового расчёта. Базовый расчёт сохранён.</summary>
            {baseRunId && <button className="button small" onClick={() => openRun(baseRunId)} disabled={runLoading}>Вернуться к базовому расчёту</button>}
            {changed.length > 0 && <div className="scenario-table"><table><thead><tr><th>Позиция</th><th className="number">Было</th><th className="number">Стало</th><th className="number">Изменение</th></tr></thead><tbody>{changed.slice(0, 100).map(d => <tr key={d.key}><td>{d.key}</td><td className="number">{num(d.before)}</td><td className="number">{num(d.after)}</td><td className="number">{d.delta > 0 ? "+" : ""}{num(d.delta)}</td></tr>)}</tbody></table></div>}
          </details>; })()}
          <section className="card order-card">
            <header className="card-header"><div><h2>Рекомендации к заказу <span className="badge" style={{ marginLeft: 8 }}>{num(filtered.length)}</span></h2><p>«Рекомендовано» — расчёт Apollon. «Количество к заказу» можно изменить; изменение снимает утверждение.</p></div>
              <div className="inline-controls"><label className="sr-only" htmlFor="run-select">Сохранённый расчёт</label><select id="run-select" value={run.id} onChange={e => openRun(e.target.value)} style={{ fontSize: 13, maxWidth: 230 }} disabled={runLoading}>{runs.map(r => <option key={r.id} value={r.id}>{dateLabel(r.createdAt)} · {new Date(r.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}{r.baseRunId ? " · сценарий" : ""}</option>)}</select></div>
            </header>
            <div className="filters">
              <div className="search-field"><Search size={15}/><input aria-label="Поиск по товарам (не влияет на расчёт)" placeholder="Название, артикул или код — фильтр отображения…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></div>
              <div className="chip-row" role="group" aria-label="Срочность">
                {([["", "Все", recommendations.length], ["CRITICAL", "Критично", urgencyCounts.CRITICAL], ["HIGH", "Высокий", urgencyCounts.HIGH], ["NORMAL", "Планово", urgencyCounts.NORMAL]] as const).map(([value, label, count]) =>
                  <button type="button" key={value || "all"} className={`chip small ${value ? `chip-${value}` : ""}`} aria-pressed={urgency === value} onClick={() => { setUrgency(value); setPage(0); }}>{label}<span className="chip-count">{num(count)}</span></button>)}
              </div>
              <span className="filters-divider" aria-hidden="true"/>
              <button type="button" className="chip small chip-review" aria-pressed={reviewOnly} onClick={() => { setReviewOnly(v => !v); setPage(0); }}>{reviewOnly && <Check size={13} aria-hidden="true"/>}Требуют проверки<span className="chip-count">{num(reviewCount)}</span></button>
              <span className="filter-spacer"/>{selected.length > 0 && <span className="filters-selected">Выбрано: {num(selected.length)}</span>}
            </div>
            <div className="table-scroll"><table className="order-table"><colgroup><col className="col-check"/><col className="col-name"/><col className="col-why"/><col className="col-num"/><col className="col-num"/><col className="col-num"/><col className="col-rec"/><col className="col-qty"/><col className="col-status"/></colgroup><thead><tr>
              <th><input type="checkbox" aria-label="Выбрать все позиции на странице" checked={visible.length > 0 && visible.every(r => selected.includes(r.key))} onChange={e => setSelected(current => e.target.checked ? [...new Set([...current, ...visible.map(r => r.key)])] : current.filter(k => !visible.some(r => r.key === k)))}/></th>
              <th><button className="table-heading-button" onClick={() => toggleSort("name")}>Наименование / артикул <ArrowUpDown size={11}/></button></th><th>Пояснение</th>
              <th className="number">Остаток</th><th className="number">В пути</th>
              <th className="number"><button className="table-heading-button" onClick={() => toggleSort("coverDays")}>Запас, дн. <ArrowUpDown size={11}/></button></th>
              <th className="number">Рекомендовано</th>
              <th><button className="table-heading-button" onClick={() => toggleSort("quantity")}>Количество к заказу <ArrowUpDown size={11}/></button></th>
              <th><button className="table-heading-button" onClick={() => toggleSort("urgency")}>Срочность / уверенность <ArrowUpDown size={11}/></button></th>
            </tr></thead>
            <tbody>{[...new Set(visible.map(r => r.supplier))].map(s => { const order = run.orders.find(o => o.supplier === s); const rows = visible.filter(r => r.supplier === s); const dirty = order && Object.keys(edits).some(k => k in order.quantities); const selectedKeys = selected.filter(k => recommendations.find(r => r.key === k)?.supplier === s);
              const supplierRows = filtered.filter(r => r.supplier === s), unitTotals = new Map<string, number>();
              let costTotal = 0, hasCost = false, costMissing = 0;
              for (const r of supplierRows) { const q = quantity(r); unitTotals.set(r.unit, (unitTotals.get(r.unit) ?? 0) + q); if (r.cost != null) { hasCost = true; costTotal += r.cost * q; } else if (q > 0) costMissing++; }
              return <SupplierRows key={s} supplier={s} count={supplierRows.length} unitTotals={unitTotals} costTotal={hasCost ? costTotal : null} costMissing={costMissing} order={order} dirty={!!dirty} busy={!!rowBusy} onSave={() => order && void saveEdits(order)} onApprove={() => { if (order) { setApproval({ order, keys: selectedKeys.length ? selectedKeys : undefined }); setAcknowledged(false); setError(""); } }} onAudit={() => order && void showAudit(order)} onDownload={format => order && void download(order, format)} selectedCount={selectedKeys.length}>
                {rows.map(r => <tr key={r.key}>
                  <td><input type="checkbox" aria-label={`Выбрать ${r.code}`} checked={selected.includes(r.key)} onChange={() => toggleKey(r.key)}/></td>
                  <td className="name-cell"><button type="button" className="product-name" title={r.name} onClick={() => setDrawerKey(r.key)}>{r.name}</button><span className="product-code">{r.supplierArticle || r.code} · {unitLabel(r.unit)} <span className="badge tiny">{r.abc}{r.xyz}</span>{r.needsReview && <span className="badge warning tiny">Требует проверки</span>}</span></td>
                  <td><button className="button small explanation-button" aria-label={`Детальный отчёт: ${r.name}`} onClick={() => setDrawerKey(r.key)}>Детальный отчёт <ArrowRight size={13} aria-hidden="true"/></button></td>
                  <td className="number">{r.provenance.stockKind === "current" ? num(r.provenance.availableStock, 1) : r.provenance.stockKind === "unknown" ? "нет данных" : <>{num(r.provenance.availableStock, 1)}<span className="product-code">оценка</span></>}</td>
                  <td className="number">{num(r.provenance.eligibleInbound, 1)}</td>
                  <td className="number">{r.coverDays == null ? "нет данных" : num(r.coverDays, 1)}</td>
                  <td className="number">{num(r.quantity)} <span className="unit-label">{unitLabel(r.unit)}</span></td>
                  <QuantityCell rec={r} value={edits[r.key] ?? quantity(r)} edited={r.key in edits} approved={!!order?.approvedKeys.includes(r.key)} onChange={v => setEdits(current => ({ ...current, [r.key]: v }))} onReset={() => setEdits(current => { const next = { ...current }; delete next[r.key]; return next; })}/>
                  <td><div className="status-stack"><span className={`badge ${r.urgency}`}>{urgencyLabels[r.urgency]}</span><span className={`badge ${r.confidence}-confidence`} title="Уверенность прогноза">{confidenceLabels[r.confidence]}</span></div></td>
                </tr>)}
              </SupplierRows>; })}
              {visible.length === 0 && <tr><td colSpan={9} style={{ textAlign: "center", padding: 35, color: "var(--muted)" }}>Нет позиций по выбранным условиям отображения</td></tr>}
            </tbody></table></div>
            <footer className="card-footer"><span>{filtered.length ? `${activePage * pageSize + 1}–${Math.min((activePage + 1) * pageSize, filtered.length)}` : "0"} из {num(filtered.length)} позиций · {hasEdits ? <span className="save-hint">Есть несохранённые изменения</span> : "Данные расчёта сохранены"}</span><div className="pager"><button aria-label="Предыдущая страница" disabled={activePage === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={13}/></button><span>{activePage + 1} / {pageCount}</span><button aria-label="Следующая страница" disabled={activePage >= pageCount - 1} onClick={() => setPage(p => p + 1)}><ChevronRight size={13}/></button></div></footer>
          </section>
          <div className="notice"><CheckCheck size={15} style={{ display: "inline", verticalAlign: "-3px", marginRight: 7 }}/> Каждый заказ проходит вашу проверку. Экспортируется только зафиксированная утверждённая версия; автоматической отправки поставщику нет.</div>
        </>}
      </>}
    </>}

    <Copilot runId={run?.id} recommendations={run?.result.recommendations}/>

    {/* Sticky bottom bar: §9 */}
    {run && run.orders.length > 0 && <div className="sticky-bar">
      <div className="sticky-bar-info"><strong>{selected.length ? `Выбрано ${num(selected.length)} позиций` : `${num(recommendations.length)} позиций в расчёте`}</strong><span>{overallStatus || "Черновик — не утверждён"}</span></div>
      <div className="sticky-bar-actions">
        {hasEdits && <button className="button" disabled={!!rowBusy} onClick={() => void saveAllEdits()}><Save size={13}/> Сохранить изменения</button>}
        {draftOrders.length > 0 && <button className="button primary" disabled={hasEdits || !!rowBusy} onClick={() => { const order = draftOrders[0]; const keys = selected.filter(k => recommendations.find(r => r.key === k)?.supplier === order.supplier); setApproval({ order, keys: keys.length ? keys : undefined }); setAcknowledged(false); setError(""); }}><Check size={13}/> Утвердить {draftOrders.length > 1 ? `(${supplierLabel(draftOrders[0].supplier)})` : ""}</button>}
        {approvedCount > 0 && run.orders.filter(o => o.status === "APPROVED").map(o => <button key={o.id} className="button small" disabled={!!rowBusy} onClick={() => void download(o, "xlsx")}><ArrowDownToLine size={12}/> {supplierLabel(o.supplier)} XLSX</button>)}
      </div>
    </div>}

    {/* Approval modal */}
    {approval && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="approve-title"><header><h2 id="approve-title">Утверждение заказа</h2><button className="icon-button" aria-label="Закрыть" onClick={() => setApproval(undefined)} disabled={rowBusy === "approve"}><X size={18}/></button></header><div className="modal-body"><p>Проверьте допущения и подтвердите количество. Утверждённые данные будут зафиксированы для экспорта.</p><ErrorNotice error={error}/><div className="approval-summary"><strong>{supplierLabel(approval.order.supplier)}</strong> · версия {approval.order.revision}<br/>{approval.keys ? `${approval.keys.length} выбранных позиций` : "Все позиции поставщика с положительным количеством"}</div><label className="field"><span>Ответственный сотрудник</span><input placeholder="Имя и фамилия" value={approver} onChange={e => setApprover(e.target.value)} autoFocus/></label><label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/> Я проверил расчёт, оценки остатков и предупреждения</label><p className="chart-caption">Имя записывается в историю утверждения без проверки личности.</p></div><footer><button className="button" onClick={() => setApproval(undefined)} disabled={rowBusy === "approve"}>Отмена</button><button className="button primary" disabled={!!rowBusy || approver.trim().length < 2 || !acknowledged} onClick={() => void approve()}>{rowBusy === "approve" ? "Утверждаем…" : "Утвердить заказ"}<Check size={14}/></button></footer></section></div>}

    {/* Audit modal */}
    {audit && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="audit-title"><header><h2 id="audit-title">История · {supplierLabel(audit.supplier)}</h2><button className="icon-button" aria-label="Закрыть историю" onClick={() => setAudit(undefined)}><X size={18}/></button></header><div className="modal-body">{audit.events.length ? audit.events.map(e => <div className="audit-row" key={e.id}><FileClock size={16}/><div><strong>{e.action || e.type || "Изменение"}</strong>{e.actor && <p>{e.actor}</p>}<pre>{JSON.stringify(e.payload || e.details || {}, null, 2)}</pre><small>{new Date(e.createdAt).toLocaleString("ru-RU")}</small></div></div>) : <p>Событий пока нет.</p>}</div></section></div>}

    {/* Drawer: §8 */}
    {drawerKey && run && (() => { const rec = recommendations.find(r => r.key === drawerKey); return rec ? <div className="drawer-backdrop" onClick={() => setDrawerKey(undefined)}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={e => e.stopPropagation()}><div className="drawer-header"><div><h2 id="drawer-title">{rec.name}</h2><p className="drawer-supplier"><SupplierLogo supplier={rec.supplier} size="sm"/><span>Артикул {rec.supplierArticle || "—"} · код 1С {rec.code}</span></p></div><button className="icon-button" aria-label="Закрыть обоснование" onClick={() => setDrawerKey(undefined)}><X size={18}/></button></div><div className="drawer-body"><SkuDetailBody rec={rec} runId={run.id} datasetId={run.datasetId} onScenario={newRunId => { const baseRunId = run.id; setDrawerKey(undefined); addRun(run.datasetId, { id: newRunId, createdAt: new Date().toISOString(), baseRunId }); openRun(newRunId, "Открыт пересчитанный сценарий. Базовый расчёт сохранён в истории."); }}/></div></aside></div> : null; })()}

    {/* Data explorer dialog: §4 "Просмотреть данные" */}
    {explorerOpen && <div className="modal-backdrop" onClick={() => setExplorerOpen(false)}><section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="explorer-title" onClick={e => e.stopPropagation()}><header><h2 id="explorer-title">Все загруженные данные</h2><button className="icon-button" aria-label="Закрыть" onClick={() => setExplorerOpen(false)}><X size={18}/></button></header><div className="modal-body"><DataExplorer/></div></section></div>}

    {/* Проверка расчёта dialog: §12 */}
    {reviewDialogOpen && <ReviewDialog onClose={() => setReviewDialogOpen(false)}/>}

    {/* History panel: §10 */}
    {historyOpen && <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={e => e.stopPropagation()}><header><h2 id="history-title">История расчётов</h2><button className="icon-button" aria-label="Закрыть историю расчётов" onClick={() => setHistoryOpen(false)}><X size={18}/></button></header><div className="modal-body">
      <ErrorNotice error={historyError}/>
      {!history ? <LoadingState text="Загружаем историю…"/> : history.length === 0 ? <p>Расчётов пока нет.</p> : <div className="history-list">{history.map(h => <button key={h.id} className="history-row" onClick={() => openHistoryEntry(h)}>
        <div><strong>{dateLabel(h.createdAt)}</strong> <span className="product-code">{new Date(h.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span></div>
        <div className="product-code">{h.datasetName} · <span className={`badge ${h.synthetic ? "demo" : "teal"}`} style={{ fontSize: 12 }}>{h.synthetic ? "Демо" : "Кейс"}</span> · {h.scope?.suppliers?.length ? h.scope.suppliers.map(supplierLabel).join(", ") : h.scope?.supplier ? supplierLabel(h.scope.supplier) : "все поставщики"}{h.scope?.category ? ` · ${categoryLabel(h.scope.category)}` : ""}</div>
        <div className="history-orders">{h.orders.map(o => <span key={o.supplier} className={`badge ${o.status}`}>{supplierLabel(o.supplier)}: {o.status === "APPROVED" ? `утверждён v${o.revision}` : "черновик"}</span>)}</div>
      </button>)}</div>}
    </div></section></div>}

    {/* New calculation confirmation when there are unsaved edits */}
    {confirmNewCalc && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-new-title"><header><h2 id="confirm-new-title">Есть несохранённые изменения</h2></header><div className="modal-body"><p>Сохранить изменения количества перед началом нового расчёта?</p></div><footer><button className="button" onClick={() => setConfirmNewCalc(false)}>Отмена</button><button className="button" onClick={resetToSource}>Не сохранять</button><button className="button primary" onClick={() => void saveAllEdits().then(resetToSource)}>Сохранить и продолжить</button></footer></section></div>}
  </div>;
}

function ReviewDialog({ onClose }: { onClose: () => void }) {
  const [tab, setTab] = useState<"checks" | "backtest" | "trends">("checks");
  return <div className="modal-backdrop" onClick={onClose}><section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="review-title" onClick={e => e.stopPropagation()}>
    <header><h2 id="review-title">Проверка расчёта</h2><button className="icon-button" aria-label="Закрыть" onClick={onClose}><X size={18}/></button></header>
    <div className="modal-body">
      <div className="tab-bar" role="tablist" aria-label="Раздел проверки"><button role="tab" aria-selected={tab === "checks"} className={tab === "checks" ? "active" : ""} onClick={() => setTab("checks")}>Проверки кейса</button><button role="tab" aria-selected={tab === "backtest"} className={tab === "backtest" ? "active" : ""} onClick={() => setTab("backtest")}>Бэктест прогноза</button><button role="tab" aria-selected={tab === "trends"} className={tab === "trends" ? "active" : ""} onClick={() => setTab("trends")}>Динамика спроса</button></div>
      {tab === "checks" && <ChecksDashboard/>}
      {tab === "backtest" && <BacktestDashboard/>}
      {tab === "trends" && <TrendsDashboard/>}
    </div>
  </section></div>;
}

function QuantityCell({ rec, value, edited, approved, onChange, onReset }: { rec: Recommendation; value: string | number; edited: boolean; approved: boolean; onChange: (v: string) => void; onReset: () => void }) {
  const multiple = rec.provenance.multiple || 1;
  const numeric = Number(value);
  const misaligned = Number.isFinite(numeric) && numeric > 0 && multiple > 1 && Math.abs(numeric / multiple - Math.round(numeric / multiple)) > 1e-6;
  const lower = misaligned ? Math.floor(numeric / multiple) * multiple : 0;
  const upper = lower + multiple;
  return <td>
    <input type="number" min={0} step="any" name={`quantity-${rec.key}`} aria-label={`Количество к заказу ${rec.code}`} className={`quantity-input ${edited ? "edited" : ""}`} value={value} onChange={e => onChange(e.target.value)}/>
    <span className="unit-label">{rec.unit}</span>
    {approved && <Check size={12} color="var(--ok)" style={{ display: "inline", marginLeft: 4 }}/>}
    {edited && <div className="product-code">Изменено вручную · <button className="table-heading-button" style={{ display: "inline-flex", color: "var(--teal)", fontWeight: 600 }} onClick={onReset}>Сбросить к рекомендации</button></div>}
    {misaligned && <div className="product-code">Кратность {num(multiple)} — ближайшее: <button className="table-heading-button" style={{ display: "inline-flex", color: "var(--teal)", fontWeight: 600 }} onClick={() => onChange(String(lower || multiple))}>{num(lower || multiple)}</button> или <button className="table-heading-button" style={{ display: "inline-flex", color: "var(--teal)", fontWeight: 600 }} onClick={() => onChange(String(upper))}>{num(upper)}</button></div>}
  </td>;
}
function SupplierRows({ supplier, count, unitTotals, costTotal, costMissing, order, dirty, busy, onSave, onApprove, onAudit, onDownload, selectedCount, children }: { supplier: string; count: number; unitTotals: Map<string, number>; costTotal: number | null; costMissing: number; order?: OrderView; dirty: boolean; busy: boolean; onSave: () => void; onApprove: () => void; onAudit: () => void; onDownload: (format: string) => void; selectedCount: number; children: React.ReactNode }) {
  return <><tr className="supplier-row"><td colSpan={9}><div className="supplier-heading"><SupplierLogo supplier={supplier}/><strong>{supplierLabel(supplier)}</strong><small>{num(count)} позиций · {[...unitTotals].map(([unit, qty]) => `${num(qty, 1)} ${unitLabel(unit)}`).join(" + ")} · {costTotal == null ? "₸ —" : costMissing ? `₸ ≥${num(costTotal)} (без цены: ${num(costMissing)} поз.)` : `₸ ${num(costTotal)}`}</small>{order && <span className={`badge ${order.status}`}>{order.status === "APPROVED" ? "Утверждён" : "Черновик"} · v{order.revision}</span>}<div className="supplier-actions">{dirty && <button className="button small" onClick={onSave} disabled={busy}><Save size={12}/> Сохранить</button>}<button className="icon-button" title="История изменений" aria-label={`История ${supplier}`} onClick={onAudit}><FileClock size={15}/></button><button className="button small" onClick={onApprove} disabled={busy || dirty || !order}><Check size={12}/>{selectedCount ? `Утвердить ${selectedCount}` : "Утвердить"}</button>{order?.status === "APPROVED" && <><button className="button small" onClick={() => onDownload("xlsx")} disabled={busy || dirty}><ArrowDownToLine size={12}/> XLSX</button><button className="button small" onClick={() => onDownload("csv")} disabled={busy || dirty}>CSV</button><button className="button small" onClick={() => onDownload("email")} disabled={busy || dirty}>Письмо</button></>}</div></div></td></tr>{children}</>;
}

/** Multi-select as toggle chips. Nothing selected = all; "all" clears the selection. */
function ChipSelect({ label, allLabel, options, value, onChange }: { label: string; allLabel: string; options: { value: string; label: React.ReactNode }[]; value: string[]; onChange: (next: string[]) => void }) {
  const toggle = (v: string) => { const next = value.includes(v) ? value.filter(x => x !== v) : [...value, v]; onChange(next.length === options.length ? [] : next); };
  return <div className="chip-select" role="group" aria-label={label}>
    <span className="chip-select-label">{label}</span>
    <div className="chip-row">
      <button type="button" className="chip" aria-pressed={value.length === 0} onClick={() => onChange([])}>{value.length === 0 && <Check size={13} aria-hidden="true"/>}{allLabel}</button>
      {options.map(o => { const on = value.includes(o.value); return <button type="button" key={o.value} className="chip" aria-pressed={on} onClick={() => toggle(o.value)}>{on && <Check size={13} aria-hidden="true"/>}{o.label}</button>; })}
    </div>
  </div>;
}

const SUPPLIER_LOGOS: Record<string, { src: string; width: number; height: number }> = {
  IEK: { src: "/brand/iek-logo.png", width: 192, height: 96 },
  SE: { src: "/brand/systeme-electric-logo.png", width: 309, height: 96 },
};
function SupplierLogo({ supplier, size = "md" }: { supplier: string; size?: "sm" | "md" }) {
  const logo = SUPPLIER_LOGOS[supplier];
  if (!logo) return <span className="badge">{supplierLabel(supplier)}</span>;
  const height = size === "sm" ? 16 : 24;
  return <Image src={logo.src} alt={supplierLabel(supplier)} width={Math.round(logo.width * height / logo.height)} height={height} className="supplier-logo-img"/>;
}
