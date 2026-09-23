"use client";

import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDownToLine, ArrowRight, ArrowUpDown, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight,
  Database, FileClock, FileSpreadsheet, FlaskConical, FolderUp, History, Play, Save, Search,
  ShieldCheck, SlidersHorizontal, Sparkles, TriangleAlert, UploadCloud, X,
} from "lucide-react";
import type { DatasetSummary, OrderView, RunView } from "@/lib/contracts/api";
import { DEFAULT_POLICY, type Policy, type Recommendation } from "@/lib/contracts/engine";
import type { RunHistoryEntry } from "@/lib/repo/explorer";
import { SkuDetailBody } from "./sku-detail";
import { DataExplorer } from "./data-explorer";
import { ChecksDashboard } from "./checks-dashboard";
import { BacktestDashboard } from "./backtest-dashboard";
import { TrendsDashboard } from "./trends-dashboard";
import { api, Copilot, dateLabel, ErrorNotice, LoadingState, Metric, num, supplierLabel, useWorkspace } from "./workspace";

type RunSummary = { id: string; createdAt: string; baseRunId: string | null };
type AuditEvent = { id: string; createdAt: string; action?: string; type?: string; actor?: string; payload?: unknown; details?: unknown };
const urgencyLabels = { CRITICAL: "Критично", HIGH: "Высокий", NORMAL: "Планово" };
const confidenceLabels = { high: "Высокая", medium: "Средняя", low: "Низкая" };

const REQUIRED_REPORTS = [
  "Товары и MOQ (минимальная партия, кратность заказа)",
  "Ежемесячные продажи в количественном выражении (2+ года истории)",
  "Ежемесячные остатки на складе",
  "Динамика продаж / сезонность",
  "Товар в пути (ожидаемые поставки с датой ETA)",
];

/**
 * Single-page procurement workspace: choose data -> validate -> calculate -> review -> adjust -> approve -> export.
 * Replaces the former sidebar-driven multi-page app (see UI_UX_REDESIGN_PROMPT.md).
 */
export function OrderWorkspace() {
  const { datasetId, dataset, datasets, details, loading: datasetsLoading, error: datasetError, selectDataset, refresh } = useWorkspace();

  // ---- Data source (upload / case data) ----
  const [sourceOpen, setSourceOpen] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadName, setUploadName] = useState("");
  const [uploadSupplier, setUploadSupplier] = useState("");
  const [sourceBusy, setSourceBusy] = useState<"" | "upload" | "refresh">("");
  const [sourceError, setSourceError] = useState("");

  // ---- Calculation scope / policy ----
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [committedPolicy, setCommittedPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [supplier, setSupplier] = useState("");
  const [category, setCategory] = useState("");
  const [committedScope, setCommittedScope] = useState({ supplier: "", category: "" });

  // ---- Runs ----
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [run, setRun] = useState<RunView>();
  const pendingRunId = useRef<string | null>(null);
  const [runLoading, setRunLoading] = useState(false);
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
  const [drawerKey, setDrawerKey] = useState<string>();
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

  const categories = useMemo(() => [...new Set((details?.suppliers || []).filter(s => !supplier || s.supplier === supplier).flatMap(s => s.categories))].sort(), [details, supplier]);
  const issues = useMemo(() => (details?.suppliers || []).flatMap(s => s.issues.map(i => ({ ...i, supplier: i.supplier || s.supplier }))), [details]);
  const blocking = issues.filter(i => i.severity === "error");
  const warnings = issues.filter(i => i.severity === "warning");
  const hasEdits = Object.keys(edits).length > 0;
  const needsRecalc = !!run && (JSON.stringify(policy) !== JSON.stringify(committedPolicy) || supplier !== committedScope.supplier || category !== committedScope.category);

  // Collapse the source step once a dataset becomes active (render-time state adjustment, not an effect: https://react.dev/learn/you-might-not-need-an-effect).
  const [lastDatasetId, setLastDatasetId] = useState(datasetId);
  if (datasetId !== lastDatasetId) { setLastDatasetId(datasetId); if (datasetId) setSourceOpen(false); }

  // Load runs for the active dataset; reopening a history entry loads that specific run instead of the latest one.
  useEffect(() => {
    if (!datasetId) return;
    let active = true;
    async function load() {
      setRunLoading(true); setError(""); setEdits({}); setSelected([]); setPage(0);
      try {
        const result = await api<{ runs: RunSummary[] }>(`/api/runs?datasetId=${encodeURIComponent(datasetId)}`);
        if (!active) return;
        setRuns(result.runs);
        const requested = pendingRunId.current; pendingRunId.current = null;
        const saved = requested || localStorage.getItem(`apollon.run.${datasetId}`);
        const id = result.runs.find(r => r.id === saved)?.id || (requested ? undefined : result.runs[0]?.id);
        if (id) {
          const loaded = await api<{ run: RunView }>(`/api/runs/${encodeURIComponent(id)}`);
          if (active) { setRun(loaded.run); setPolicy(loaded.run.result.policy); setCommittedPolicy(loaded.run.result.policy); }
        } else if (requested) {
          const loaded = await api<{ run: RunView }>(`/api/runs/${encodeURIComponent(requested)}`);
          if (active) { setRun(loaded.run); setPolicy(loaded.run.result.policy); setCommittedPolicy(loaded.run.result.policy); }
        } else if (active) setRun(undefined);
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Не удалось открыть расчёты"); }
      finally { if (active) setRunLoading(false); }
    }
    void load();
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
      const body = new FormData(); files.forEach(file => body.append("files", file));
      if (uploadName.trim()) body.append("name", uploadName.trim());
      if (uploadSupplier) body.append("supplier", uploadSupplier);
      const result = await api<{ dataset: DatasetSummary }>("/api/import", { method: "POST", body });
      await refresh(result.dataset.id);
      setFiles([]); setUploadName(""); setUploadSupplier("");
      setSuccess(`«${result.dataset.name}» загружен. Проверьте сводку данных ниже и запустите расчёт.`);
    } catch (e) { setSourceError(e instanceof Error ? e.message : "Не удалось загрузить данные"); }
    finally { setSourceBusy(""); }
  }

  // Opens a saved run without recalculating; resets per-run UI state so edits never leak across runs.
  async function openRun(id: string, notice?: string) {
    pendingRunId.current = id; setRun(undefined); setError(""); setSuccess("");
    try {
      const r = await api<{ run: RunView }>(`/api/runs/${encodeURIComponent(id)}`);
      setRun(r.run); setPolicy(r.run.result.policy); setCommittedPolicy(r.run.result.policy);
      setEdits({}); setSelected([]); setPage(0);
      localStorage.setItem(`apollon.run.${r.run.datasetId}`, r.run.id);
      if (notice) setSuccess(notice);
    } catch (err) { setError(err instanceof Error ? err.message : "Не удалось открыть расчёт"); }
    finally { pendingRunId.current = null; }
  }

  async function calculate() {
    if (!datasetId || calcBusy) return;
    setCalcBusy(true); setError(""); setSuccess("");
    try {
      const result = await api<{ run: RunView }>("/api/runs", { method: "POST", body: JSON.stringify({ datasetId, policy, ...(supplier ? { supplier } : {}), ...(category ? { category } : {}) }) });
      setRun(result.run);
      setRuns(r => [{ id: result.run.id, createdAt: result.run.createdAt, baseRunId: null }, ...r]);
      setEdits({}); setSelected([]); setPage(0);
      setCommittedPolicy(policy); setCommittedScope({ supplier, category });
      localStorage.setItem(`apollon.run.${datasetId}`, result.run.id);
      setSuccess("Расчёт готов. Проверьте рекомендации перед утверждением.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ошибка расчёта"); }
    finally { setCalcBusy(false); }
  }

  const recommendations = useMemo(() => run?.result.recommendations || [], [run]);
  function quantity(r: Recommendation) { return run?.orders.find(o => o.supplier === r.supplier)?.quantities[r.key] ?? r.quantity; }
  const filtered = useMemo(() => {
    const ranks = { CRITICAL: 0, HIGH: 1, NORMAL: 2 };
    return recommendations.filter(r => (!urgency || r.urgency === urgency) && (!reviewOnly || r.needsReview) && (!query || `${r.name} ${r.code} ${r.supplierArticle}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()))).sort((a, b) => {
      if (sort.key === "name") return a.name.localeCompare(b.name, "ru") * sort.direction;
      if (sort.key === "urgency") return (ranks[a.urgency] - ranks[b.urgency]) * sort.direction;
      return ((a[sort.key] ?? Infinity) - (b[sort.key] ?? Infinity)) * sort.direction;
    });
  }, [recommendations, urgency, reviewOnly, query, sort]);
  const pageSize = 20; const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize)); const activePage = Math.min(page, pageCount - 1); const visible = filtered.slice(activePage * pageSize, (activePage + 1) * pageSize);
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
    pendingRunId.current = entry.id;
    setHistoryOpen(false); setSourceOpen(false); setSuccess(""); setError("");
    if (entry.datasetId !== datasetId) selectDataset(entry.datasetId);
    else { // same dataset: trigger the load effect manually since datasetId won't change
      void openRun(entry.id);
    }
  }

  function startNewCalculation() {
    if (hasEdits) { setConfirmNewCalc(true); return; }
    resetToSource();
  }
  function resetToSource() {
    selectDataset(""); setRun(undefined); setRuns([]); setEdits({}); setSelected([]);
    setPolicy(DEFAULT_POLICY); setCommittedPolicy(DEFAULT_POLICY); setSupplier(""); setCategory(""); setCommittedScope({ supplier: "", category: "" });
    setSourceOpen(true); setError(""); setSuccess(""); setConfirmNewCalc(false);
  }

  const datasetIssueCount = details ? issues.length : 0;

  return <div className="app-shell">
    <header className="app-header">
      <div className="app-brand">
        <Image src="/brand/ekt-logo-256.png" alt="Электрокомплект" width={38} height={38} className="app-brand-logo"/>
        <div className="app-brand-text"><span>Apollon</span><small>закуп для ТОО «Электрокомплект»</small></div>
      </div>
      <div className="app-header-actions">
        <button className="button" onClick={startNewCalculation}><Sparkles size={14}/> Новый расчёт</button>
        <button className="button" onClick={openHistory}><History size={14}/> История расчётов</button>
      </div>
    </header>

    <ErrorNotice error={datasetError || error}/>
    {success && <div className="notice" role="status"><Check size={14} style={{ display: "inline", verticalAlign: "-3px", marginRight: 7 }}/>{success}</div>}

    {(sourceOpen || !datasetId) ? <>
      <div className="page-heading no-margin"><div><h1>Рассчитайте заказ поставщику</h1><p>Загрузите свои отчёты или используйте подготовленные данные кейса.</p></div></div>
      <div className="source-cards">
        <section className="card"><header className="card-header"><div><h2>Загрузить свои отчёты</h2><p>Каждая загрузка создаёт отдельный набор данных.</p></div><span className="badge">XLSX</span></header><div className="card-body">
          <div className="upload-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); setFiles(Array.from(e.dataTransfer.files)); }}>
            <UploadCloud size={30}/><h3>Перенесите файлы Excel сюда</h3><p>Продажи, остатки, сезонность, MOQ/кратность и товары в пути</p>
            <label className="sr-only" htmlFor="workbook-files">Выберите рабочие книги</label>
            <input id="workbook-files" type="file" accept=".xlsx" multiple onChange={e => setFiles(Array.from(e.target.files || []))}/>
          </div>
          {files.length > 0 && <div className="file-list">{files.map((file, i) => <div className="file-row" key={`${file.name}-${i}`}><FileSpreadsheet size={15}/><span>{file.name}</span><small>{num(file.size / 1024)} КБ</small></div>)}</div>}
          <div className="upload-fields">
            <label className="field"><span>Название набора</span><input value={uploadName} onChange={e => setUploadName(e.target.value)} placeholder="Например, отчёты за сентябрь"/></label>
            <label className="field"><span>Поставщик</span><select value={uploadSupplier} onChange={e => setUploadSupplier(e.target.value)}><option value="">Определить автоматически</option><option value="IEK">IEK</option><option value="SE">Systeme Electric</option></select></label>
          </div>
          <button className="button primary" disabled={!files.length || !!sourceBusy} onClick={() => void importData()}>{sourceBusy === "upload" ? <span className="spinner"/> : <FolderUp size={15}/>} {sourceBusy === "upload" ? "Импортируем и проверяем…" : "Загрузить отчёты"}</button>
          <ErrorNotice error={sourceError}/>
          <details className="advanced-policy"><summary className="subtle-summary">Какие файлы нужны и где взять примеры <ChevronDown size={12} style={{ display: "inline" }}/></summary>
            <ul style={{ margin: "8px 0 0", paddingLeft: 18, fontSize: 14, color: "var(--muted)", lineHeight: 1.9 }}>{REQUIRED_REPORTS.map(r => <li key={r}>{r}</li>)}</ul>
            <p className="chart-caption">Примеры файлов IEK и Systeme Electric лежат в каталоге <code>sample-data/</code> репозитория (см. sample-data/README.md) — их можно загрузить сюда напрямую.</p>
          </details>
        </div></section>
        <section className="card demo-card"><div className="card-body">
          <div className="demo-symbol"><FlaskConical size={26}/></div>
          <div className="eyebrow">Можно начать без своих файлов</div>
          <h2>Использовать данные кейса</h2>
          <p>Сохранённые в базе наборы данных, подготовленные для расчёта.</p>
          {datasetsLoading ? <LoadingState text="Загружаем список наборов…"/> : datasets.length === 0 ? <p className="chart-caption">Наборов для расчёта пока нет. Сохранённые исходные книги требуют отдельного сопоставления полей перед расчётом.</p> : <div className="dataset-list">
            {datasets.map(d => <div className="dataset-list-row" key={d.id}>
              <div><strong>{d.name}</strong><span className={`badge ${d.synthetic ? "demo" : "teal"}`} style={{ marginLeft: 8 }}>{d.synthetic ? "Демо-данные" : "Данные кейса"}</span>
                <div className="dataset-suppliers">{[...new Set(d.files.map(f => f.supplier).filter(Boolean))].map(s => <SupplierLogo key={s} supplier={String(s)} size="sm"/>)}</div>
                <div className="product-code">{num(d.productCount)} товаров · данные на {dateLabel(d.cutoffDate)} · загружено {dateLabel(d.createdAt)}{d.issueCount ? ` · ${num(d.issueCount)} замечаний` : ""}</div>
              </div>
              <button className="button small" onClick={() => selectDataset(d.id)}>Использовать <ArrowRight size={12}/></button>
            </div>)}
          </div>}
          <button className="button dark" disabled={!!sourceBusy} onClick={() => void refreshData()} style={{ marginTop: 14 }}>{sourceBusy === "refresh" ? <span className="spinner"/> : <Database size={15}/>} {sourceBusy === "refresh" ? "Обновляем список…" : "Обновить список данных"}<ArrowRight size={14}/></button>
        </div></section>
      </div>
    </> : null}

    {datasetId && !sourceOpen && <>
      <div className="context-bar">
        <div><Database size={14}/><strong>{dataset?.name || "…"}</strong><span className={`badge ${dataset?.synthetic ? "demo" : "teal"}`}>{dataset?.synthetic ? "Демо-данные" : "Данные кейса"}</span></div>
        <span className="context-bar-detail">{dataset ? `Данные на ${dateLabel(dataset.cutoffDate)} · ${num(dataset.productCount)} товаров` : ""}{supplier ? ` · ${supplierLabel(supplier)}` : " · все поставщики"}{category ? ` · категория ${category}` : ""}</span>
        <button className="button small" onClick={() => setSourceOpen(true)}>Изменить данные</button>
      </div>

      {datasetsLoading ? <LoadingState/> : <>
        <section className="card">
          <header className="card-header"><div><h2>Проверка данных перед расчётом</h2><p>{details ? details.name : "Загружаем сводку…"}</p></div>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="button small" onClick={() => setExplorerOpen(true)}><Search size={12}/> Просмотреть данные</button>
              <button className="button small" onClick={() => setReviewDialogOpen(true)}><ShieldCheck size={12}/> Проверка расчёта</button>
            </div>
          </header>
          {!details ? <div className="card-body"><LoadingState text="Читаем сводку набора данных…"/></div> : <div className="card-body">
            <div className="metrics" style={{ marginBottom: 0 }}>
              <Metric label="Товаров в наборе" value={num(details.suppliers.reduce((n, s) => n + s.productCount, 0))} detail={`${details.suppliers.length} поставщика`} tone="teal"/>
              <Metric label="Строк операций" value={num(details.suppliers.reduce((n, s) => n + s.transactionCount, 0))} detail="История продаж" />
              <Metric label="Исходных файлов" value={num(details.files.length)} detail={`Данные на ${dateLabel(details.cutoffDate)}`}/>
              <Metric label="Замечаний" value={num(datasetIssueCount)} detail={blocking.length ? `${blocking.length} требуют внимания` : warnings.length ? `${warnings.length} предупреждений` : "Критичных нет"} tone={blocking.length ? "red" : warnings.length ? "orange" : ""}/>
            </div>
            {blocking.length > 0 && <div className="notice danger" style={{ marginTop: 16 }}><strong>Требует внимания перед расчётом ({blocking.length}):</strong> данные с такими замечаниями учтены расчётом как предположения — результат будет предварительным. Откройте «Просмотреть данные», чтобы уточнить исходные файлы.</div>}
            {warnings.length > 0 && <details className="notice warning" style={{ marginTop: blocking.length ? 10 : 16 }}><summary>Предупреждения, не блокирующие расчёт · {warnings.length}</summary>{warnings.slice(0, 30).map((w, i) => <p key={i}>{supplierLabel(w.supplier || "")}: {w.message}</p>)}</details>}
            <div className="table-scroll" style={{ marginTop: 16 }}><table><thead><tr><th>Поставщик</th><th>Товаров</th><th>Категории</th><th>Замечания</th></tr></thead><tbody>
              {details.suppliers.map(s => <tr key={s.supplier}><td><span className="drawer-supplier"><SupplierLogo supplier={s.supplier} size="sm"/><strong>{supplierLabel(s.supplier)}</strong></span></td><td>{num(s.productCount)}</td><td>{s.categories.filter(Boolean).join(", ") || "Не указаны"}</td><td>{num(s.issues.length)}</td></tr>)}
            </tbody></table></div>
          </div>}
        </section>

        <section className="card">
          <header className="card-header"><div><h2><SlidersHorizontal size={16} style={{ display: "inline", verticalAlign: "-3px", marginRight: 8 }}/> Параметры расчёта</h2><p>Область расчёта. Расширенные настройки планирования — ниже.</p></div>
            <button className="button primary" disabled={!datasetId || calcBusy} onClick={() => void calculate()}>{calcBusy ? <span className="spinner"/> : <Play size={14}/>} {run ? "Пересчитать" : "Рассчитать заказ"}</button>
          </header>
          <div className="card-body">
            {needsRecalc && <div className="notice warning" style={{ marginBottom: 14 }}><TriangleAlert size={13} style={{ display: "inline", verticalAlign: "-2px", marginRight: 6 }}/>Параметры изменены — требуется пересчёт. Таблица ниже показывает результат предыдущего расчёта.</div>}
            <div className="policy-grid" style={{ gridTemplateColumns: "repeat(2,minmax(0,1fr))" }}>
              <label className="field"><span>Область расчёта — поставщик</span><select value={supplier} onChange={e => { setSupplier(e.target.value); setCategory(""); }}><option value="">Все поставщики</option>{(details?.suppliers || []).map(s => <option key={s.supplier} value={s.supplier}>{supplierLabel(s.supplier)}</option>)}</select></label>
              <label className="field"><span>Категория</span><select value={category} onChange={e => setCategory(e.target.value)}><option value="">Все категории</option>{categories.map(c => <option key={c} value={c}>{c || "Без категории"}</option>)}</select></label>
            </div>
            <details className="advanced-policy"><summary className="subtle-summary">Расширенные настройки планирования <ChevronDown size={12} style={{ display: "inline" }}/></summary>
              <p className="chart-caption">Изменение любого параметра ниже требует нового расчёта. Фильтры таблицы результатов (поиск, срочность) на расчёт не влияют.</p>
              <div className="inline-controls" style={{ marginTop: 10 }}>
                <label className="field"><span>Срок поставки, дней</span><input type="number" min={1} max={365} value={policy.leadTimeDays} onChange={e => updatePolicy("leadTimeDays", Number(e.target.value))}/></label>
                <label className="field"><span>Период обзора, дней</span><input type="number" min={1} max={180} value={policy.reviewDays} onChange={e => updatePolicy("reviewDays", Number(e.target.value))}/></label>
                <label className="field"><span>Уровень сервиса, %</span><input type="number" min={50} max={99.9} step={.1} value={Number((policy.serviceLevel * 100).toFixed(2))} onChange={e => updatePolicy("serviceLevel", Number(e.target.value) / 100)}/></label>
                <label className="field"><span>Минимальный запас, дней</span><input type="number" min={0} max={180} value={policy.safetyDays} onChange={e => updatePolicy("safetyDays", Number(e.target.value))}/></label>
                <label className="field"><span>Рост спроса, % / год</span><input type="number" min={-95} max={300} placeholder="Из данных" value={policy.growthRate === null ? "" : Number((policy.growthRate * 100).toFixed(2))} onChange={e => updatePolicy("growthRate", e.target.value === "" ? null : Number(e.target.value) / 100)}/></label>
                <label className="field"><span>Как применять рост</span><select value={policy.growthMode} onChange={e => updatePolicy("growthMode", e.target.value as Policy["growthMode"])}><option value="replace">Заменить оценённый тренд</option><option value="additive">Добавить к тренду</option></select></label>
              </div>
              <div className="policy-toggles"><label className="checkbox-label"><input type="checkbox" checked={policy.stockoutCompensation} onChange={e => updatePolicy("stockoutCompensation", e.target.checked)}/> Компенсация упущенного спроса при дефиците</label><label className="checkbox-label"><input type="checkbox" checked={policy.outlierFiltering} onChange={e => updatePolicy("outlierFiltering", e.target.checked)}/> Исключение разовых заказов из спроса</label></div>
              {categories.length > 0 && <><p className="chart-caption" style={{ marginTop: 14 }}>Политики по категориям — необязательные переопределения общих настроек выше.</p>
              <div className="category-policy-grid">{categories.map(c => <div className="field" key={c}><span>Категория {c || "без категории"}</span>
                <label className="field"><span>Уровень сервиса, %</span><input type="number" min={50} max={99.9} step={.1} aria-label={`Сервис категории ${c}`} value={Number(((policy.categoryServiceLevels[c] ?? policy.serviceLevel) * 100).toFixed(2))} onChange={e => updatePolicy("categoryServiceLevels", { ...policy.categoryServiceLevels, [c]: Number(e.target.value) / 100 })}/></label>
                <label className="field"><span>Минимальный запас, дней</span><input type="number" min={0} max={180} aria-label={`Запас категории ${c}`} value={policy.categorySafetyDays[c] ?? policy.safetyDays} onChange={e => updatePolicy("categorySafetyDays", { ...policy.categorySafetyDays, [c]: Number(e.target.value) })}/></label>
                <label className="field"><span>Резервный спрос, ед./мес</span><input type="number" min={0} placeholder="Из истории" aria-label={`Резервный спрос категории ${c}`} value={policy.categoryFallbackDemand[c] ?? ""} onChange={e => updatePolicy("categoryFallbackDemand", { ...policy.categoryFallbackDemand, [c]: e.target.value === "" ? undefined as unknown as number : Number(e.target.value) })}/></label>
              </div>)}</div></>}
            </details>
          </div>
        </section>

        {runLoading ? <LoadingState text="Открываем сохранённый расчёт…"/> : !run ? <div className="empty-state"><div className="empty-icon"><Play size={25}/></div><h2>Данные готовы к расчёту</h2><p>Задайте область расчёта выше и нажмите «Рассчитать заказ». Apollon учтёт историю спроса, остатки, сезонность и ожидаемые поставки.</p></div> : <>
          {run.result.warnings.length > 0 && <details className="notice warning"><summary>Допущения расчёта · {run.result.warnings.length}</summary>{run.result.warnings.map((w, i) => <p key={i}>{w}</p>)}</details>}
          <div className="metrics">
            <Metric label="Позиций в расчёте" value={num(recommendations.length)} detail={`${new Set(recommendations.map(r => r.supplier)).size} поставщика · ${dateLabel(run.result.cutoffDate)}`} tone="teal"/>
            <Metric label="Требуют заказа" value={num(recommendations.filter(r => quantity(r) > 0).length)} detail="Потребность после учёта остатков"/>
            <Metric label="Риск дефицита" value={num(recommendations.filter(r => r.urgency === "CRITICAL").length)} detail="Дефицит до следующей поставки" tone="red"/>
            <Metric label="Утверждено позиций" value={num(approvedCount)} detail={approvedCount ? "Зафиксированы для экспорта" : "Ожидают проверки менеджера"} tone="orange"/>
          </div>
          {run.scenarioDelta && (() => { const changed = run.scenarioDelta.filter(d => d.delta !== 0); const baseRunId = runs.find(r => r.id === run.id)?.baseRunId; return <details className="scenario-banner" open>
            <summary>Сценарий: изменилось {num(changed.length)} позиций относительно базового расчёта. Базовый расчёт сохранён.</summary>
            {baseRunId && <button className="button small" onClick={() => void openRun(baseRunId)} disabled={runLoading}>Вернуться к базовому расчёту</button>}
            {changed.length > 0 && <div className="scenario-table"><table><thead><tr><th>Позиция</th><th className="number">Было</th><th className="number">Стало</th><th className="number">Изменение</th></tr></thead><tbody>{changed.slice(0, 100).map(d => <tr key={d.key}><td>{d.key}</td><td className="number">{num(d.before)}</td><td className="number">{num(d.after)}</td><td className="number">{d.delta > 0 ? "+" : ""}{num(d.delta)}</td></tr>)}</tbody></table></div>}
          </details>; })()}
          <section className="card">
            <header className="card-header"><div><h2>Рекомендации к заказу <span className="badge" style={{ marginLeft: 8 }}>{num(filtered.length)}</span></h2><p>«Рекомендовано» — расчёт Apollon. «Количество к заказу» можно изменить; изменение снимает утверждение.</p></div>
              <div className="inline-controls"><label className="sr-only" htmlFor="run-select">Сохранённый расчёт</label><select id="run-select" value={run.id} onChange={e => void openRun(e.target.value)} style={{ fontSize: 13, maxWidth: 230 }} disabled={runLoading}>{runs.map(r => <option key={r.id} value={r.id}>{dateLabel(r.createdAt)} · {new Date(r.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}{r.baseRunId ? " · сценарий" : ""}</option>)}</select></div>
            </header>
            <div className="filters">
              <div className="search-field"><Search size={15}/><input aria-label="Поиск по товарам (не влияет на расчёт)" placeholder="Название, артикул или код — фильтр отображения…" value={query} onChange={e => { setQuery(e.target.value); setPage(0); }}/></div>
              <select aria-label="Фильтр срочности" value={urgency} onChange={e => { setUrgency(e.target.value); setPage(0); }}><option value="">Любая срочность</option><option value="CRITICAL">Критично</option><option value="HIGH">Высокий приоритет</option><option value="NORMAL">Планово</option></select>
              <label className="checkbox-label"><input type="checkbox" checked={reviewOnly} onChange={e => { setReviewOnly(e.target.checked); setPage(0); }}/> Требуют проверки</label>
              <span className="filter-spacer"/><span className="muted" style={{ fontSize: 13 }}>{selected.length ? `Выбрано: ${selected.length}` : "Группировка по поставщику"}</span>
            </div>
            <div className="table-scroll"><table><thead><tr>
              <th><input type="checkbox" aria-label="Выбрать все позиции на странице" checked={visible.length > 0 && visible.every(r => selected.includes(r.key))} onChange={e => setSelected(current => e.target.checked ? [...new Set([...current, ...visible.map(r => r.key)])] : current.filter(k => !visible.some(r => r.key === k)))}/></th>
              <th><button className="table-heading-button" onClick={() => toggleSort("name")}>Наименование / артикул <ArrowUpDown size={11}/></button></th>
              <th className="number">Остаток</th><th className="number">В пути</th>
              <th className="number"><button className="table-heading-button" onClick={() => toggleSort("coverDays")}>Запас, дн. <ArrowUpDown size={11}/></button></th>
              <th>Рекомендовано</th>
              <th><button className="table-heading-button" onClick={() => toggleSort("quantity")}>Количество к заказу <ArrowUpDown size={11}/></button></th>
              <th>Срочность</th><th>Уверенность</th><th>Пояснение</th>
            </tr></thead>
            <tbody>{[...new Set(visible.map(r => r.supplier))].map(s => { const order = run.orders.find(o => o.supplier === s); const rows = visible.filter(r => r.supplier === s); const dirty = order && Object.keys(edits).some(k => k in order.quantities); const selectedKeys = selected.filter(k => recommendations.find(r => r.key === k)?.supplier === s);
              const supplierRows = filtered.filter(r => r.supplier === s), unitTotals = new Map<string, number>();
              let costTotal = 0, hasCost = false, costMissing = 0;
              for (const r of supplierRows) { const q = quantity(r); unitTotals.set(r.unit, (unitTotals.get(r.unit) ?? 0) + q); if (r.cost != null) { hasCost = true; costTotal += r.cost * q; } else if (q > 0) costMissing++; }
              return <SupplierRows key={s} supplier={s} count={supplierRows.length} unitTotals={unitTotals} costTotal={hasCost ? costTotal : null} costMissing={costMissing} order={order} dirty={!!dirty} busy={!!rowBusy} onSave={() => order && void saveEdits(order)} onApprove={() => { if (order) { setApproval({ order, keys: selectedKeys.length ? selectedKeys : undefined }); setAcknowledged(false); setError(""); } }} onAudit={() => order && void showAudit(order)} onDownload={format => order && void download(order, format)} selectedCount={selectedKeys.length}>
                {rows.map(r => <tr key={r.key}>
                  <td><input type="checkbox" aria-label={`Выбрать ${r.code}`} checked={selected.includes(r.key)} onChange={() => toggleKey(r.key)}/></td>
                  <td><button className="product-name table-heading-button" style={{ display: "block", textAlign: "left" }} onClick={() => setDrawerKey(r.key)}>{r.name}</button><span className="product-code">{r.supplierArticle || r.code} · {r.unit} <span className="badge" style={{ fontSize: 12, padding: "1px 4px", marginLeft: 4 }}>{r.abc}{r.xyz}</span>{r.needsReview && <span title="Требует проверки" style={{ color: "#b38f4d", marginLeft: 5 }}>●</span>}</span></td>
                  <td className="number">{r.provenance.stockKind === "current" ? num(r.provenance.availableStock, 1) : r.provenance.stockKind === "unknown" ? "нет данных" : <>{num(r.provenance.availableStock, 1)}<span className="product-code">оценка</span></>}</td>
                  <td className="number">{num(r.provenance.eligibleInbound, 1)}</td>
                  <td className="number">{r.coverDays == null ? "нет данных" : num(r.coverDays, 1)}</td>
                  <td className="number">{num(r.quantity)} {r.unit}</td>
                  <QuantityCell rec={r} value={edits[r.key] ?? quantity(r)} edited={r.key in edits} approved={!!order?.approvedKeys.includes(r.key)} onChange={v => setEdits(current => ({ ...current, [r.key]: v }))} onReset={() => setEdits(current => { const next = { ...current }; delete next[r.key]; return next; })}/>
                  <td><span className={`badge ${r.urgency}`}>{urgencyLabels[r.urgency]}</span></td>
                  <td><span className={`badge ${r.confidence}-confidence`}>{confidenceLabels[r.confidence]}</span></td>
                  <td><button className="icon-button" aria-label={`Обоснование ${r.code}`} onClick={() => setDrawerKey(r.key)}><ArrowRight size={14}/></button></td>
                </tr>)}
              </SupplierRows>; })}
              {visible.length === 0 && <tr><td colSpan={10} style={{ textAlign: "center", padding: 35, color: "var(--muted)" }}>Нет позиций по выбранным условиям отображения</td></tr>}
            </tbody></table></div>
            <footer className="card-footer"><span>{filtered.length ? `${activePage * pageSize + 1}–${Math.min((activePage + 1) * pageSize, filtered.length)}` : "0"} из {num(filtered.length)} позиций · {hasEdits ? <span className="save-hint">Есть несохранённые изменения</span> : "Данные расчёта сохранены"}</span><div className="pager"><button aria-label="Предыдущая страница" disabled={activePage === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft size={13}/></button><span>{activePage + 1} / {pageCount}</span><button aria-label="Следующая страница" disabled={activePage >= pageCount - 1} onClick={() => setPage(p => p + 1)}><ChevronRight size={13}/></button></div></footer>
          </section>
          <div className="notice"><CheckCheck size={15} style={{ display: "inline", verticalAlign: "-3px", marginRight: 7 }}/> Каждый заказ проходит вашу проверку. Экспортируется только зафиксированная утверждённая версия; автоматической отправки поставщику нет.</div>
        </>}
      </>}
    </>}

    <Copilot runId={run?.id}/>

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
    {approval && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="approve-title"><header><h2 id="approve-title">Утверждение заказа</h2><button className="icon-button" aria-label="Закрыть" onClick={() => setApproval(undefined)} disabled={rowBusy === "approve"}><X size={18}/></button></header><div className="modal-body"><p>Проверьте допущения и подтвердите количество. Утверждённые данные будут зафиксированы для экспорта.</p><ErrorNotice error={error}/><div className="approval-summary"><strong>{supplierLabel(approval.order.supplier)}</strong> · версия {approval.order.revision}<br/>{approval.keys ? `${approval.keys.length} выбранных позиций` : "Все позиции поставщика с положительным количеством"}</div><label className="field"><span>Ответственный сотрудник</span><input placeholder="Имя и фамилия" value={approver} onChange={e => setApprover(e.target.value)} autoFocus/></label><label className="checkbox-label"><input type="checkbox" checked={acknowledged} onChange={e => setAcknowledged(e.target.checked)}/> Я проверил расчёт, оценки остатков и предупреждения</label><p className="chart-caption">В демонстрации имя записывается в историю без проверки личности.</p></div><footer><button className="button" onClick={() => setApproval(undefined)} disabled={rowBusy === "approve"}>Отмена</button><button className="button primary" disabled={!!rowBusy || approver.trim().length < 2 || !acknowledged} onClick={() => void approve()}>{rowBusy === "approve" ? "Утверждаем…" : "Утвердить заказ"}<Check size={14}/></button></footer></section></div>}

    {/* Audit modal */}
    {audit && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="audit-title"><header><h2 id="audit-title">История · {supplierLabel(audit.supplier)}</h2><button className="icon-button" aria-label="Закрыть историю" onClick={() => setAudit(undefined)}><X size={18}/></button></header><div className="modal-body">{audit.events.length ? audit.events.map(e => <div className="audit-row" key={e.id}><FileClock size={16}/><div><strong>{e.action || e.type || "Изменение"}</strong>{e.actor && <p>{e.actor}</p>}<pre>{JSON.stringify(e.payload || e.details || {}, null, 2)}</pre><small>{new Date(e.createdAt).toLocaleString("ru-RU")}</small></div></div>) : <p>Событий пока нет.</p>}</div></section></div>}

    {/* Drawer: §8 */}
    {drawerKey && run && (() => { const rec = recommendations.find(r => r.key === drawerKey); return rec ? <div className="drawer-backdrop" onClick={() => setDrawerKey(undefined)}><aside className="drawer" role="dialog" aria-modal="true" aria-labelledby="drawer-title" onClick={e => e.stopPropagation()}><div className="drawer-header"><div><h2 id="drawer-title">{rec.name}</h2><p className="drawer-supplier"><SupplierLogo supplier={rec.supplier} size="sm"/>{rec.supplierArticle || rec.code} · {supplierLabel(rec.supplier)}</p></div><button className="icon-button" aria-label="Закрыть обоснование" onClick={() => setDrawerKey(undefined)}><X size={18}/></button></div><div className="drawer-body"><SkuDetailBody rec={rec} runId={run.id} datasetId={run.datasetId} onScenario={newRunId => { const baseRunId = run.id; setDrawerKey(undefined); setRuns(r => [{ id: newRunId, createdAt: new Date().toISOString(), baseRunId }, ...r.filter(x => x.id !== newRunId)]); void openRun(newRunId, "Открыт пересчитанный сценарий. Базовый расчёт сохранён в истории."); }}/></div></aside></div> : null; })()}

    {/* Data explorer dialog: §4 "Просмотреть данные" */}
    {explorerOpen && <div className="modal-backdrop" onClick={() => setExplorerOpen(false)}><section className="modal wide" role="dialog" aria-modal="true" aria-labelledby="explorer-title" onClick={e => e.stopPropagation()}><header><h2 id="explorer-title">Все загруженные данные</h2><button className="icon-button" aria-label="Закрыть" onClick={() => setExplorerOpen(false)}><X size={18}/></button></header><div className="modal-body"><DataExplorer/></div></section></div>}

    {/* Проверка расчёта dialog: §12 */}
    {reviewDialogOpen && <ReviewDialog onClose={() => setReviewDialogOpen(false)}/>}

    {/* History panel: §10 */}
    {historyOpen && <div className="modal-backdrop" onClick={() => setHistoryOpen(false)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="history-title" onClick={e => e.stopPropagation()}><header><h2 id="history-title">История расчётов</h2><button className="icon-button" aria-label="Закрыть историю расчётов" onClick={() => setHistoryOpen(false)}><X size={18}/></button></header><div className="modal-body">
      <ErrorNotice error={historyError}/>
      {!history ? <LoadingState text="Загружаем историю…"/> : history.length === 0 ? <p>Расчётов пока нет.</p> : <div className="history-list">{history.map(h => <button key={h.id} className="history-row" onClick={() => openHistoryEntry(h)}>
        <div><strong>{dateLabel(h.createdAt)}</strong> <span className="product-code">{new Date(h.createdAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</span></div>
        <div className="product-code">{h.datasetName} · <span className={`badge ${h.synthetic ? "demo" : "teal"}`} style={{ fontSize: 12 }}>{h.synthetic ? "Демо" : "Кейс"}</span> · {h.scope?.supplier ? supplierLabel(h.scope.supplier) : "все поставщики"}{h.scope?.category ? ` · ${h.scope.category}` : ""}</div>
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
  return <><tr className="supplier-row"><td colSpan={10}><div className="supplier-heading"><SupplierLogo supplier={supplier}/><strong>{supplierLabel(supplier)}</strong><small>{num(count)} позиций · {[...unitTotals].map(([unit, qty]) => `${num(qty, 1)} ${unit}`).join(" + ")} · {costTotal == null ? "₸ —" : costMissing ? `₸ ≥${num(costTotal)} (без цены: ${num(costMissing)} поз.)` : `₸ ${num(costTotal)}`}</small>{order && <span className={`badge ${order.status}`}>{order.status === "APPROVED" ? "Утверждён" : "Черновик"} · v{order.revision}</span>}<div className="supplier-actions">{dirty && <button className="button small" onClick={onSave} disabled={busy}><Save size={12}/> Сохранить</button>}<button className="icon-button" title="История изменений" aria-label={`История ${supplier}`} onClick={onAudit}><FileClock size={15}/></button><button className="button small" onClick={onApprove} disabled={busy || dirty || !order}><Check size={12}/>{selectedCount ? `Утвердить ${selectedCount}` : "Утвердить"}</button>{order?.status === "APPROVED" && <><button className="button small" onClick={() => onDownload("xlsx")} disabled={busy || dirty}><ArrowDownToLine size={12}/> XLSX</button><button className="button small" onClick={() => onDownload("csv")} disabled={busy || dirty}>CSV</button><button className="button small" onClick={() => onDownload("email")} disabled={busy || dirty}>Письмо</button></>}</div></div></td></tr>{children}</>;
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
