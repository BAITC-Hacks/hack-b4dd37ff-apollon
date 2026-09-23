import ExcelJS from "exceljs";
import JSZip from "jszip";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FIXED_DATE = new Date("2026-09-22T00:00:00.000Z");
const MONTH_NAMES = ["янв.", "февр.", "март", "апр.", "май", "июнь", "июль", "авг.", "сент.", "окт.", "нояб.", "дек."];
const FULL_MONTHS = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
const MONTHS = Array.from({ length: 33 }, (_, i) => `${2024 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, "0")}`);
const SEASON = [0.55, 0.58, 0.76, 0.94, 1.08, 1.22, 1.40, 1.48, 1.27, 1.05, 0.90, 0.77];
const DESCRIPTIONS = ["Сезонный прожектор Север", "Растущая серия выключателей Вега", "Розетка Орион — дефицит", "Автомат Полюс — подтверждённый дефицит", "Контактор Искра — разовый проект", "Модуль Лира — разделённый проект", "Кабель Полярис 305м ЗАКУПАЮТСЯ БУХТАМИ, САДЯТСЯ МЕТРАЖОМ", "Рамка Янтарь — малая потребность", "Реле Луна — запас и ранний приход", "Датчик Зенит — поздний приход", "Щит Парус — возвраты", "Светильник Комета — редкие продажи"];
interface DemoProduct { code: string; article: string; name: string; unit: string; category: number; cost: number; moq: number; sales: number[]; stock: (number | null)[]; transactions: (string | number)[][] }
function rng(seed: number) { let state = seed >>> 0; return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; }; }
function products(supplier: "IEK" | "SE"): DemoProduct[] {
  const random = rng(supplier === "IEK" ? 48151 : 96227);
  return Array.from({ length: 24 }, (_, index) => {
    const code = `00DEMO-${supplier}-${String(index + 1).padStart(3, "0")}_`;
    const p: DemoProduct = { code, article: `SYN-${supplier}-${String(index + 1).padStart(4, "0")}`, name: `[СИНТЕТИКА] ${DESCRIPTIONS[index] || `Механизм Созвездие ${index + 1}`}`, unit: index === 6 ? "м" : "шт", category: [1, 2, 3, 5, 7][index % 5], cost: Math.round((140 + random() * 2500) * 100) / 100, moq: [1, 6, 10, 12, 20, 50][index % 6], sales: [], stock: [], transactions: [] };
    const base = index === 6 ? 720 : index === 7 ? 7 : 45 + Math.round(random() * 260);
    for (let t = 0; t < MONTHS.length; t++) {
      const [year, month] = MONTHS[t].split("-").map(Number);
      const season = index === 0 ? SEASON[t % 12] ** 1.6 : SEASON[t % 12];
      const trend = index === 1 ? (t >= 24 ? 1.55 : 1) * 1.008 ** t : 1.003 ** t;
      let amount = Math.round(base * season * trend * (0.93 + random() * 0.14));
      if (index >= 11 && index % 3 === 2 && random() < 0.55) amount = 0;
      if (index === 23 && t < 25) amount = 0;
      if ((index === 2 || index === 3) && [27, 28].includes(t)) amount = Math.round(amount * 0.15);
      if (t === 32) amount = Math.round(amount * 22 / 30);
      let opening: number | null = Math.round(base * (1.05 + random() * 0.8));
      if ((index === 2 || index === 3) && [27, 28].includes(t)) opening = null;
      if (index === 23 && t < 25) opening = null;
      if (index === 9 && t === 32) opening = 8;
      if (index === 8 && t === 32) opening = base * 6;
      if (index === 22 && t === 11) opening = -3;
      p.stock.push(opening);
      let net = amount;
      if (t >= 12) {
        const count = amount > 0 ? 8 : 0;
        let remainder = amount;
        for (let n = 0; n < count; n++) {
          const qty = n === count - 1 ? remainder : Math.floor(amount / count);
          remainder -= qty;
          const lastDay = ((index === 2 || index === 3) && [27, 28].includes(t)) ? 7 : t === 32 ? 22 : 27;
          const day = Math.max(1, Math.round(1 + n * (lastDay - 1) / 7));
          const date = `${String(day).padStart(2, "0")}.${String(month).padStart(2, "0")}.${year} 10:00:00`;
          const invoice = `DEMO-${supplier}-${index}-${t}-${n}`;
          p.transactions.push([date, invoice, `Расходная накладная ${invoice}`, code, p.name, p.unit, "Демо-склад", qty, `SYN-C${(n + index) % 19}`]);
        }
        if (index === 4 && t === 25) {
          const quantity = base * 50;
          p.transactions.push([`15.02.2026 11:00:00`, `SYN-PROJECT-${supplier}`, `Расходная накладная SYN-PROJECT-${supplier}`, code, p.name, p.unit, "Демо-склад", quantity, "SYN-PROJECT"]);
          net += quantity;
        }
        if (index === 5 && t === 26) {
          for (let split = 0; split < 10; split++) p.transactions.push([`${String(split + 10).padStart(2, "0")}.03.2026 12:00:00`, `SYN-SPLIT-${supplier}-${split}`, `Расходная накладная SYN-SPLIT-${supplier}-${split}`, code, p.name, p.unit, "Демо-склад", base * 5, "SYN-SPLIT-CUSTOMER"]);
          net += base * 50;
        }
        if (index === 10 && t % 4 === 0) {
          p.transactions.push([`20.${String(month).padStart(2, "0")}.${year} 12:00:00`, `SYN-RETURN-${supplier}-${t}`, `Расходная накладная SYN-RETURN-${supplier}-${t}`, code, p.name, p.unit, "Демо-склад", -15, "SYN-RETURN"]);
          net -= 15;
        }
      }
      p.sales.push(net);
    }
    return p;
  });
}
function workbook(): ExcelJS.Workbook {
  const book = new ExcelJS.Workbook();
  book.creator = "Apollon synthetic data generator"; book.created = FIXED_DATE; book.modified = FIXED_DATE;
  book.title = "SYNTHETIC / СИНТЕТИЧЕСКИЕ ДАННЫЕ — не партнёрские данные";
  return book;
}
async function save(book: ExcelJS.Workbook, path: string) {
  await mkdir(dirname(path), { recursive: true });
  for (const sheet of book.worksheets) {
    sheet.views = [{ state: "frozen", ySplit: sheet.name === "TDSheet" ? 2 : 1 }];
    sheet.getRow(sheet.name === "TDSheet" ? 2 : 1).font = { bold: true };
  }
  const buffer = await book.xlsx.writeBuffer();
  const zip = await JSZip.loadAsync(buffer);
  zip.forEach((_, entry) => { entry.date = FIXED_DATE; });
  await writeFile(path, await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } }));
}
function addSeasonSheet(book: ExcelJS.Workbook, ps: DemoProduct[], sheetName: string) {
  const s = book.addWorksheet(sheetName);
  s.addRows([[], [], ["год", "янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек", "ИТОГО"]]);
  for (let year = 2024; year <= 2026; year++) {
    const totals = Array.from({ length: 12 }, (_, m) => (year === 2026 && m > 8) ? null : ps.reduce((sum, p) => sum + (p.sales[(year - 2024) * 12 + m] || 0) * p.cost, 0));
    s.addRow([year, ...totals, totals.reduce<number>((sum, n) => sum + (n || 0), 0)]);
  }
  s.getRow(8).getCell(2).value = "Сезонность по годам";
  s.getRow(10).values = [null, "Месяц", "Продажи 2024", "Коэф. сезонности", "Доля в году", "Продажи 2025", "Коэф. сезонности 2025", "Доля в году 2025", "Продажи 2026", "Коэф. сезонности 2026", "Доля в году 2026", "СЕЗОННОСТЬ"];
  for (let m = 0; m < 12; m++) s.getRow(11 + m).values = [null, MONTH_NAMES[m].replace(".", ""), null, SEASON[m], null, null, SEASON[m], null, null, SEASON[m], null, SEASON[m]];
}

/** Creates all twelve partner-shaped input workbooks, with fictional codes/names/volumes. */
export async function generateDemoWorkbooks(directory: string): Promise<void> {
  for (const supplier of ["IEK", "SE"] as const) {
    const ps = products(supplier), se = supplier === "SE";
    const folder = join(directory, se ? "Systeme electric" : "IEK");
    const monthHeaders = MONTHS.map((m, i) => `${MONTH_NAMES[i % 12]} ${m.slice(0, 4)}`);
    const sales = workbook(), saleSheet = sales.addWorksheet("Лист_1");
    saleSheet.addRow(["Номенклатура", "Номенклатура.Код", ...(se ? ["Артикул", "Кратность"] : []), ...monthHeaders, "Итого"]);
    saleSheet.addRow([null, null, ...(se ? [null, null] : []), ...MONTHS.map(() => "Количество")]);
    ps.forEach((p, i) => {
      const numbers: ExcelJS.CellValue[] = p.sales.map((n) => n === 0 ? null : n);
      if (i === 21) numbers[5] = "ошибка";
      const line = saleSheet.addRow([p.name, p.code, ...(se ? [p.article, i % 4 === 0 ? 0 : p.moq] : []), ...numbers, p.sales.reduce((a, b) => a + b, 0)]);
      if (i === 0) line.getCell(se ? 5 : 3).value = { formula: `${p.sales[0]}*1`, result: p.sales[0] };
    });
    saleSheet.addRow(["Итого", null, ...(se ? [null, null] : []), ...MONTHS.map((_, t) => ps.reduce((sum, p) => sum + p.sales[t], 0))]);
    if (se) addSeasonSheet(sales, ps, "Лист1");
    await save(sales, join(folder, se ? "Ежемесячные продажи в кол-м выражении SystemElectric 2024-2026.xlsx" : "Ежемесячные продажи в количественном выражении за последние 2 года.xlsx"));

    const stocks = workbook(), stockSheet = stocks.addWorksheet("Лист_1");
    stockSheet.addRow([...(se ? ["№", "Номенклатура", "Номенклатура.Код", "Ед.изм"] : ["Номенклатура", "Ед.", "Номенклатура.Код"]), ...monthHeaders, ...(se ? [] : ["Итого"])]);
    stockSheet.addRow([]); stockSheet.addRow(se ? [] : [null, null, null, ...MONTHS.map(() => "нач. остаток")]);
    ps.forEach((p, i) => stockSheet.addRow([...(se ? [i + 1, p.name, p.code, p.unit] : [p.name, p.unit, p.code]), ...p.stock, ...(se ? [] : [p.stock[0]])]));
    await save(stocks, join(folder, se ? "Ежемесячные остатки SystemElectric 2024-2026.xlsx" : "Ежемесячные остатки продукции за последние 2 года  ИЭК.xlsx"));

    const tx = workbook(), txSheet = tx.addWorksheet("Лист_1");
    txSheet.addRow(["Дата", "Номер", "Документ", "Код", "Номенклатура", "Ед.", "Склад", "Количество", "anonymized_customer_id"]);
    ps.forEach((p) => p.transactions.forEach((row) => txSheet.addRow(row)));
    txSheet.addRow(["21.09.2026 10:00:00", "SYN-UNFULFILLED", "Заказ покупателя SYN-UNFULFILLED", ps[0].code, ps[0].name, "шт", "Демо-склад", 999999, "SYN-C0"]);
    txSheet.addRow(["не дата", "SYN-BAD", "Расходная накладная SYN-BAD", ps[1].code, ps[1].name, "шт", "Демо-склад", "не число"]);
    txSheet.addRow([null, null, "Итого", null, null, null, null, 999999]);
    await save(tx, join(folder, se ? "Динамика продаж_Syseme Electric_2025-2026.xlsx" : "Динамика продаж_2025-2026.xlsx"));

    const moq = workbook(), moqSheet = moq.addWorksheet(se ? "Лист_1" : "Лист7");
    moqSheet.addRow(se ? ["№", "Номенклатура", "Номенклатура.Код", "Артикул", "Кратность"] : ["№", "Код 1с", "Артикул поставщика", "Наименование", "Мин. разр. к отгр."]);
    if (se) moqSheet.addRow([]);
    ps.forEach((p, i) => {
      if (i === 20) return;
      const value: ExcelJS.CellValue = i === 22 ? { error: "#N/A" } : p.moq;
      const row = se ? [i + 1, p.name, p.code, p.article, value] : [i + 1, p.code, p.article, p.name, value];
      moqSheet.addRow(row); if (i === 0) moqSheet.addRow(row);
    });
    const supplements = moq.addWorksheet("Supplements (SYNTHETIC)");
    supplements.addRow(["Код", "unit_conversion", "stockout_start", "stockout_end", "current_stock", "snapshot_date"]);
    supplements.addRow([ps[6].code, 305]);
    supplements.addRow([ps[3].code, null, "2026-04-08", "2026-05-31"]);
    await save(moq, join(folder, se ? "MOQ SystemElectric.xlsx" : "MOQ  ИЭК.xlsx"));

    const transit = workbook(), tr = transit.addWorksheet(se ? "TDSheet" : "Лист4");
    if (se) {
      tr.getRow(1).getCell(46).value = "СКЛАДЫ";
      const headers = ["№", "Артикул поставщика", "Код 1с", "Наименование", "Категория 2026", "СС реал", ...FULL_MONTHS.map((m) => `${m} 2024 г.`), "Продажи 2024", "Ср мес 2024", ...FULL_MONTHS.map((m) => `${m} 2025 г.`), ...FULL_MONTHS.slice(0, 9).map((m) => `${m} 2026 г.`), "Сумма последние 12 мес", "   Ср мес за последние 12 мес", "Кэф. Роста", "Кэф. Сез-ти", "Витрина", "Остаток ТЗ", "РЦ ЕКТ  Рыскулова", "Розничный склад", "Остаток", "Зарезервировано", "Свободный остаток", "Запас", "Заказ", "СЭ в пути 24.09"];
      tr.addRow(headers);
      ps.forEach((p, i) => {
        const recent = p.sales.slice(20).reduce((a, b) => a + b, 0), firstYear = p.sales.slice(0, 12).reduce((a, b) => a + b, 0);
        const gross = i === 9 ? 8 : i === 8 ? 1200 : 25 + i * 4, reserved = i === 2 ? 20 : 0;
        tr.addRow([i + 1, p.article, p.code, p.name, String(p.category), p.cost, ...p.sales.slice(0, 12), firstYear, firstYear / 12, ...p.sales.slice(12), recent, recent / 12, i === 1 ? 0.3 : 0.04, SEASON[8] - 1, 0, 0, 0, 0, gross, reserved, { formula: `AX${i + 3}-AY${i + 3}`, result: gross - reserved }, 0, null, i === 8 ? 600 : i === 2 ? 70 : 0]);
      });
      addSeasonSheet(transit, ps, "Лист1");
    } else {
      tr.addRow(["Код 1с", "Артикул ИЭК", " Наименование", "РФ УТ-DEMO1 от 31 августа 2026 г. (поступление до 10.10.2026)", "РФ УТ-DEMO2 от 10 сентября 2026 г. (поступление до 15.10.2026)", "ПП УТ-DEMO3 от 7 сентября 2026 г. (поступление до 01.10.2026)", "УТ-DEMO4 от 18 сентября 2026 г. (поступление до 30.09.2026)", "УТ-DEMO5 от 1 сентября 2026 г. (поступление до 20.09.2026)", "УТ-DEMO6 от 18 сентября 2026 г. (поступление до 20.01.2027)"]);
      ps.forEach((p, i) => {
        const row = [p.code, p.article, p.name, i % 4 === 0 ? 120 : null, i % 7 === 0 ? 80 : null, i === 8 ? 600 : null, i === 2 ? 60 : null, i === 12 ? 40 : null, i === 9 ? 5000 : null];
        tr.addRow(row); if (i === 0) tr.addRow(row);
      });
    }
    await save(transit, join(folder, se ? "Товар в пути_SystemElectric на 22.09.2026.xlsx" : "Путь ИЭК 22.09.2026.xlsx"));
    const season = workbook(); addSeasonSheet(season, ps, se ? "Лист1" : "Сезонность");
    await save(season, join(folder, se ? "Сезонность SystemElectric 2024-2026.xlsx" : "Сезонность ИЭК.xlsx"));
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateDemoWorkbooks(resolve(process.argv[2] || "sample-data")).then(() => console.log("Generated 12 deterministic synthetic partner-layout workbooks."));
}
