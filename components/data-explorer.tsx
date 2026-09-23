"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { api, dateLabel, LoadingState, Metric, num, PageHeading, supplierLabel, useWorkspace } from "./workspace";

type Tab = "products" | "sales" | "stocks" | "transactions" | "deliveries" | "issues";
const tabs: { id: Tab; label: string }[] = [
  { id: "products", label: "Товары" },
  { id: "sales", label: "Продажи по месяцам" },
  { id: "stocks", label: "Остатки по месяцам" },
  { id: "transactions", label: "Транзакции" },
  { id: "deliveries", label: "Товар в пути" },
  { id: "issues", label: "Проблемы импорта" },
];
interface Page<T> { rows: T[]; total: number; page: number; pageSize: number }

function usePagedData<T>(endpoint: string, datasetId: string, supplier: string, query: string, page: number) {
  const key = JSON.stringify({ endpoint, datasetId, supplier, query, page });
  const [state, setState] = useState<{ key: string; data?: Page<T>; error?: string }>();
  useEffect(() => {
    if (!datasetId || !endpoint) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ datasetId, page: String(page), pageSize: "50" });
    if (supplier) params.set("supplier", supplier);
    if (query) params.set("q", query);
    api<Page<T>>(`/api/data/${endpoint}?${params}`, { signal: controller.signal })
      .then(data => setState({ key, data }))
      .catch(e => { if (!controller.signal.aborted) setState({ key, error: e instanceof Error ? e.message : "Ошибка загрузки" }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const current = state?.key === key ? state : undefined;
  return { data: current?.data, loading: !!datasetId && !!endpoint && !current, error: current?.error };
}

function Pager({ page, pageSize, total, onChange }: { page: number; pageSize: number; total: number; onChange: (p: number) => void }) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  return <div className="pagination-bar"><span className="muted" style={{ fontSize: 10 }}>{total ? `${page * pageSize + 1}–${Math.min((page + 1) * pageSize, total)} из ${num(total)}` : "Нет строк"}</span><button className="icon-button" aria-label="Предыдущая страница" disabled={page === 0} onClick={() => onChange(page - 1)}><ChevronLeft size={14} /></button><span style={{ fontSize: 10 }}>{page + 1} / {pageCount}</span><button className="icon-button" aria-label="Следующая страница" disabled={page >= pageCount - 1} onClick={() => onChange(page + 1)}><ChevronRight size={14} /></button></div>;
}

export function DataExplorer() {
  const { datasetId, dataset, details, loading: datasetLoading } = useWorkspace();
  const [tab, setTab] = useState<Tab>("products");
  const [supplier, setSupplier] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  // Reset pagination when the active filters change, without a dedicated effect (React's "adjusting state during render" pattern).
  const filterKey = `${tab}|${supplier}|${query}|${datasetId}`;
  const [prevFilterKey, setPrevFilterKey] = useState(filterKey);
  if (prevFilterKey !== filterKey) { setPrevFilterKey(filterKey); if (page !== 0) setPage(0); }
  const endpoint = tab === "products" ? "products" : tab === "sales" ? "sales" : tab === "stocks" ? "stocks" : tab === "transactions" ? "transactions" : tab === "deliveries" ? "deliveries" : "";
  const paged = usePagedData<Record<string, unknown>>(endpoint, tab === "issues" ? "" : datasetId, supplier, query, page);
  const issues = useMemo(() => (details?.suppliers || []).filter(s => !supplier || s.supplier === supplier).flatMap(s => s.issues.map(i => ({ ...i, supplier: i.supplier || s.supplier }))), [details, supplier]);

  if (datasetLoading) return <LoadingState />;

  const columns: Record<Exclude<Tab, "issues">, { key: string; label: string; number?: boolean }[]> = {
    products: [{ key: "code", label: "Код 1С" }, { key: "article", label: "Артикул" }, { key: "name", label: "Наименование" }, { key: "unit", label: "Ед." }, { key: "category", label: "Категория" }, { key: "moq", label: "MOQ", number: true }, { key: "multiple", label: "Кратность", number: true }],
    sales: [{ key: "code", label: "Код 1С" }, { key: "article", label: "Артикул" }, { key: "name", label: "Наименование" }, { key: "month", label: "Месяц" }, { key: "quantity", label: "Количество", number: true }, { key: "unit", label: "Ед." }],
    stocks: [{ key: "code", label: "Код 1С" }, { key: "article", label: "Артикул" }, { key: "name", label: "Наименование" }, { key: "month", label: "Месяц" }, { key: "quantity", label: "Остаток", number: true }, { key: "unit", label: "Ед." }],
    transactions: [{ key: "date", label: "Дата" }, { key: "invoice", label: "Накладная" }, { key: "code", label: "Код 1С" }, { key: "name", label: "Наименование" }, { key: "quantity", label: "Количество", number: true }, { key: "unit", label: "Ед." }, { key: "warehouse", label: "Склад" }],
    deliveries: [{ key: "code", label: "Код 1С" }, { key: "name", label: "Наименование" }, { key: "quantity", label: "Количество", number: true }, { key: "unit", label: "Ед." }, { key: "eta", label: "ETA" }, { key: "orderDate", label: "Дата заказа" }, { key: "receivedDate", label: "Получено" }],
  };
  const cols = tab === "issues" ? [] : columns[tab];

  return <>
    <PageHeading eyebrow="Полный доступ к загруженным данным" title="Данные" description={`${dataset?.name || ""} · товары, продажи, остатки, транзакции и поставки по обоим поставщикам с пагинацией на сервере.`} />
    <div className="metrics"><Metric label="Товаров" value={num(details?.suppliers.reduce((n, s) => n + s.productCount, 0))} tone="teal" /><Metric label="Операций" value={num(details?.suppliers.reduce((n, s) => n + s.transactionCount, 0))} /><Metric label="Поставщиков" value={num(details?.suppliers.length)} /><Metric label="Замечаний аудита" value={num(details?.suppliers.reduce((n, s) => n + s.issues.length, 0))} tone="orange" /></div>
    <div className="tab-bar" role="tablist" aria-label="Разделы данных">{tabs.map(t => <button key={t.id} role="tab" aria-selected={tab === t.id} className={tab === t.id ? "active" : ""} onClick={() => setTab(t.id)}>{t.label}</button>)}</div>
    <div className="data-toolbar">
      <select aria-label="Поставщик" value={supplier} onChange={e => setSupplier(e.target.value)}><option value="">Все поставщики</option>{(details?.suppliers || []).map(s => <option key={s.supplier} value={s.supplier}>{supplierLabel(s.supplier)}</option>)}</select>
      {tab !== "issues" && <div className="search-field" style={{ minWidth: 260 }}><Search size={15} /><input aria-label="Поиск по коду, артикулу или названию" placeholder="Код 1С, артикул или наименование…" value={query} onChange={e => setQuery(e.target.value)} /></div>}
    </div>
    <section className="card">
      {tab === "issues" ? <>
        <div className="table-scroll"><table><thead><tr><th>Уровень</th><th>Поставщик</th><th>Замечание</th><th>Источник</th></tr></thead><tbody>
          {issues.slice(0, 300).map((issue, i) => <tr key={i}><td><span className={`badge ${issue.severity === "error" ? "danger" : issue.severity === "warning" ? "warning" : ""}`}>{issue.severity === "error" ? "Ошибка" : issue.severity === "warning" ? "Внимание" : "Инфо"}</span></td><td>{supplierLabel(issue.supplier || "")}</td><td className="issue-message">{issue.message}{issue.code && <span className="product-code">{issue.code}</span>}</td><td className="issue-source" title={issue.source?.file}>{issue.source?.file || "—"}{issue.source?.sheet && <div>{issue.source.sheet}{issue.source.row ? ` · строка ${issue.source.row}` : ""}</div>}</td></tr>)}
          {issues.length === 0 && <tr><td colSpan={4} style={{ textAlign: "center", padding: 25 }}>Замечаний нет</td></tr>}
        </tbody></table></div>
        <footer className="card-footer"><span>Показано {Math.min(300, issues.length)} из {num(issues.length)}</span></footer>
      </> : <>
        {paged.error && <div className="notice danger" role="alert" style={{ margin: 15 }}>{paged.error}</div>}
        <div className="table-scroll"><table><thead><tr>{cols.map(c => <th key={c.key} className={c.number ? "number" : undefined}>{c.label}</th>)}</tr></thead><tbody>
          {(paged.data?.rows || []).map((row, i) => <tr key={i}>{cols.map(c => <td key={c.key} className={c.number ? "number" : undefined}>{c.key === "eta" || c.key === "orderDate" || c.key === "receivedDate" || c.key === "date" ? (row[c.key] ? dateLabel(String(row[c.key])) : "—") : c.number ? num(row[c.key] as number | null) : (row[c.key] as string) ?? "—"}</td>)}</tr>)}
          {!paged.loading && (paged.data?.rows.length ?? 0) === 0 && <tr><td colSpan={cols.length} style={{ textAlign: "center", padding: 25 }}>Нет строк по выбранным условиям</td></tr>}
        </tbody></table></div>
        {paged.loading && <LoadingState text="Загружаем строки…" />}
        <footer className="card-footer"><Pager page={paged.data?.page ?? page} pageSize={paged.data?.pageSize ?? 50} total={paged.data?.total ?? 0} onChange={setPage} /></footer>
      </>}
    </section>
  </>;
}
