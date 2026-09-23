import ExcelJS from "exceljs";
import type { ExportLine, OrderView } from "@/lib/contracts/api";
export function safeText(value:unknown):string{const text=String(value??"");return /^[\s\uFEFF]*[=+@-]/u.test(text)?`'${text}`:text;}
export const exportColumns={code:"Код 1с",article:"Артикул поставщика",name:"Наименование",quantity:"Количество",unit:"Ед.",supplier:"Поставщик"} as const;
export type ExportColumn=keyof typeof exportColumns;
const csvCell=(v:unknown)=>`"${safeText(v).replaceAll('"','""')}"`;
export function supplierCsv(lines:ExportLine[],columns:ExportColumn[]=Object.keys(exportColumns) as ExportColumn[]):string{
 const rows=lines.map(({recommendation:r,quantity})=>({code:r.code,article:r.supplierArticle,name:r.name,quantity,unit:r.unit,supplier:r.supplier}));
 return "\uFEFF"+[columns.map(c=>csvCell(exportColumns[c])).join(";"),...rows.map(r=>columns.map(c=>csvCell(r[c])).join(";"))].join("\r\n");
}
export async function supplierWorkbook(lines:ExportLine[],order:OrderView):Promise<Buffer>{
 const workbook=new ExcelJS.Workbook();workbook.creator="Apollon";workbook.created=new Date();
 for(const supplier of [...new Set(lines.map(l=>l.recommendation.supplier))]){
  const sheet=workbook.addWorksheet(supplier==="SE"?"Systeme Electric":"IEK",{views:[{state:"frozen",ySplit:1}]});
  sheet.columns=[{header:"Код 1с",key:"code",width:18},{header:"Артикул поставщика",key:"article",width:25},{header:"Наименование",key:"name",width:55},{header:"Категория 2026",key:"category",width:16},{header:"Свободный остаток",key:"stock",width:20},{header:"В пути",key:"inbound",width:16},{header:"Заказ",key:"quantity",width:16},{header:"Ед.",key:"unit",width:10},{header:"Обоснование",key:"reason",width:90},{header:"Срочность",key:"urgency",width:16}];
  for(const {recommendation:r,quantity}of lines.filter(l=>l.recommendation.supplier===supplier)){sheet.addRow({code:safeText(r.code),article:safeText(r.supplierArticle),name:safeText(r.name),category:safeText(r.category),stock:r.provenance.availableStock,inbound:r.provenance.eligibleInbound,quantity,unit:safeText(r.unit),reason:safeText(r.explanation),urgency:r.urgency});}
  sheet.getRow(1).font={bold:true,color:{argb:"FFFFFFFF"}};sheet.getRow(1).fill={type:"pattern",pattern:"solid",fgColor:{argb:"FF163B3B"}};sheet.autoFilter={from:{row:1,column:1},to:{row:sheet.rowCount,column:10}};
 }
 const audit=workbook.addWorksheet("Утверждение");audit.addRows([["Заказ",safeText(order.id)],["Версия",order.revision],["Утвердил",safeText(order.approver)],["Дата",order.approvedAt??""],["Совместимость 1С","Формат необходимо проверить в учётной системе"]]);audit.getColumn(1).width=26;audit.getColumn(2).width=75;
 return Buffer.from(await workbook.xlsx.writeBuffer());
}
export function supplierEmail(lines:ExportLine[],order:OrderView):string{
 return [`Черновик письма — не отправлено`,`Тема: Заказ ${order.supplier} / ${order.id}`,"",`Добрый день!`,`Просим подтвердить возможность поставки:`,...lines.map(({recommendation:r,quantity})=>`${r.supplierArticle||r.code} — ${r.name}: ${quantity} ${r.unit}`),"",`Утверждено: ${order.approver}; версия ${order.revision}.`,`Пожалуйста, подтвердите сроки поставки и условия оплаты.`].join("\n");
}
