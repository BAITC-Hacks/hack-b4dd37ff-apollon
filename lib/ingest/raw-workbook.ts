import { createHash } from "node:crypto";
import { posix } from "node:path";
import JSZip from "jszip";
import { SaxesParser } from "saxes";

export const RAW_PARSER_VERSION = "ooxml-source-1";
export interface XmlNode { name: string; attributes: Record<string, string>; children: (XmlNode | string)[] }
export interface RawCell {
  attributes: Record<string, string>;
  /** null = no v element; empty string = present but empty v element. Numbers stay lexical strings. */
  value: string | null;
  formula: XmlNode | null;
  /** Shared/inline text for querying, without trimming or Excel escape decoding. */
  text: string | null;
  /** Non-v/f children, including rich inline strings, preserved structurally. */
  extra: XmlNode[];
}
export interface RawRow { ordinal: number; attributes: Record<string, string>; cells: RawCell[]; extra: XmlNode[] }
export interface RawSheet {
  ordinal: number; name: string; path: string; attributes: Record<string, string>;
  dimension: string | null; metadata: XmlNode; rows: RawRow[];
}
export interface RawWorkbook {
  sha256: string; parserVersion: string; originalBytes: Buffer;
  metadata: { workbook: XmlNode; relationships: XmlNode; sharedStrings: XmlNode | null };
  sheets: RawSheet[];
}
const local = (name: string) => name.split(":").at(-1)!;
const elements = (n: XmlNode) => n.children.filter((v): v is XmlNode => typeof v !== "string");
const child = (n: XmlNode, name: string) => elements(n).find(c => local(c.name) === name);
const textContent = (n: XmlNode): string => n.children.map(c => typeof c === "string" ? c : textContent(c)).join("");
function stringText(n: XmlNode): string {
  if (local(n.name) === "rPh") return ""; // phonetic annotation is retained in original structure, not display text
  if (local(n.name) === "t") return textContent(n);
  return elements(n).map(stringText).join("");
}

/** Extract source row nodes as the parser closes them; do not retain the full sheet XML tree. */
function xml(source: string, onRow?: (row: XmlNode) => void): XmlNode {
  const parser = new SaxesParser({ xmlns: false });
  const stack: XmlNode[] = [];
  let root: XmlNode | undefined;
  parser.on("doctype", () => { throw new Error("DTD is not supported in workbook XML"); });
  parser.on("opentag", tag => {
    const node: XmlNode = { name: tag.name, attributes: { ...tag.attributes }, children: [] };
    if (stack.length) stack.at(-1)!.children.push(node); else root = node;
    stack.push(node);
  });
  const append = (value: string) => { if (stack.length) stack.at(-1)!.children.push(value); };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    const node = stack.pop()!;
    if (onRow && local(node.name) === "row" && local(stack.at(-1)?.name ?? "") === "sheetData") {
      onRow(node);
      stack.at(-1)!.children.pop();
    }
  });
  parser.write(source).close();
  if (!root) throw new Error("Empty workbook XML");
  return root;
}

function sourceCell(node: XmlNode, shared: XmlNode[]): RawCell {
  const valueNode = child(node, "v");
  const value = valueNode ? textContent(valueNode) : null;
  const type = node.attributes.t;
  let text: string | null = null;
  if (type === "s") {
    if (value === null || !/^\d+$/.test(value) || !shared[Number(value)]) throw new Error("Invalid shared-string reference");
    text = stringText(shared[Number(value)]);
  } else if (type === "inlineStr") {
    const inline = child(node, "is");
    text = inline ? stringText(inline) : null;
  } else if (type === "str") text = value;
  return {
    attributes: node.attributes, value, formula: child(node, "f") ?? null, text,
    extra: elements(node).filter(n => !["v", "f"].includes(local(n.name))),
  };
}

/** No business interpretation, date conversion, filtering, deduplication or formula evaluation. */
export async function parseRawWorkbook(bytes: Buffer): Promise<RawWorkbook> {
  if (bytes.length > 30 * 1024 * 1024) throw new Error("Workbook exceeds 30 MiB");
  // Inspect the central directory before CRC verification decompresses any entries.
  const zip = await JSZip.loadAsync(bytes);
  let inflated = 0;
  zip.forEach((_, entry) => { inflated += (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0; });
  if (inflated > 350 * 1024 * 1024) throw new Error("Workbook exceeds 350 MiB uncompressed");
  await JSZip.loadAsync(bytes, { checkCRC32: true });
  const read = async (path: string) => {
    const file = zip.file(path);
    if (!file) throw new Error(`Workbook part missing: ${path}`);
    return file.async("string");
  };
  const relationships = xml(await read("xl/_rels/workbook.xml.rels"));
  const rels = elements(relationships);
  const part = (rel: XmlNode) => {
    if (rel.attributes.TargetMode === "External") throw new Error("External worksheet relationships are unsupported");
    const target = rel.attributes.Target;
    const path = target.startsWith("/") ? posix.normalize(target.slice(1)) : posix.join("xl", target);
    if (path.startsWith("../")) throw new Error("Invalid workbook part path");
    return path;
  };
  const workbook = xml(await read("xl/workbook.xml"));
  const sharedRel = rels.find(r => r.attributes.Type?.endsWith("/sharedStrings"));
  const sharedStrings = sharedRel ? xml(await read(part(sharedRel))) : null;
  const shared = sharedStrings ? elements(sharedStrings).filter(n => local(n.name) === "si") : [];
  const sheetNodes = child(workbook, "sheets");
  if (!sheetNodes || !elements(sheetNodes).length) throw new Error("Workbook has no sheets");
  const sheets: RawSheet[] = [];
  for (const node of elements(sheetNodes)) {
    const id = Object.entries(node.attributes).find(([key]) => key.endsWith(":id"))?.[1];
    const rel = rels.find(r => r.attributes.Id === id);
    if (!rel || !rel.attributes.Type?.endsWith("/worksheet")) throw new Error("Unsupported or missing sheet relationship");
    const path = part(rel), rows: RawRow[] = [];
    const metadata = xml(await read(path), row => {
      rows.push({ ordinal: rows.length + 1, attributes: row.attributes,
        cells: elements(row).filter(n => local(n.name) === "c").map(n => sourceCell(n, shared)),
        extra: elements(row).filter(n => local(n.name) !== "c") });
    });
    if (local(metadata.name) !== "worksheet") throw new Error("Invalid worksheet root");
    sheets.push({ ordinal: sheets.length + 1, name: node.attributes.name, path,
      attributes: node.attributes, dimension: child(metadata, "dimension")?.attributes.ref ?? null, metadata, rows });
  }
  return { sha256: createHash("sha256").update(bytes).digest("hex"), parserVersion: RAW_PARSER_VERSION,
    originalBytes: bytes, metadata: { workbook, relationships, sharedStrings }, sheets };
}

export function rawWorkbookSummary(book: RawWorkbook) {
  return { sha256: book.sha256, parserVersion: book.parserVersion, sheets: book.sheets.map(s => ({
    name: s.name, dimension: s.dimension, rows: s.rows.length,
    cells: s.rows.reduce((n, r) => n + r.cells.length, 0),
    formulas: s.rows.reduce((n, r) => n + r.cells.filter(c => c.formula !== null).length, 0),
    errors: s.rows.reduce((n, r) => n + r.cells.filter(c => c.attributes.t === "e").length, 0),
  })) };
}
