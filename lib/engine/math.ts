export const finite = (value: number | null | undefined, fallback = 0): number => typeof value === "number" && Number.isFinite(value) ? value : fallback;
export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, finite(n)));
export const sum = (values: number[]) => values.reduce((total, n) => total + finite(n), 0);
export const mean = (values: number[]) => values.length ? sum(values) / values.length : 0;
export function quantile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = values.map(n => finite(n)).sort((a, b) => a - b);
  const position = clamp(p, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}
export const median = (values: number[]) => quantile(values, .5);
export const std = (values: number[]) => { const average = mean(values); return values.length < 2 ? 0 : Math.sqrt(sum(values.map(n => (n - average) ** 2)) / (values.length - 1)); };
export const mad = (values: number[]) => { const center = median(values); return median(values.map(n => Math.abs(n - center))); };
export const round = (n: number, digits = 4) => Number(finite(n).toFixed(digits));
export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export const dateOf = (day: string) => new Date(`${day.slice(0, 10)}T00:00:00Z`);
export const addDays = (day: string, count: number) => isoDay(new Date(dateOf(day).getTime() + count * 86400000));
export const diffDays = (from: string, to: string) => Math.round((dateOf(to).getTime() - dateOf(from).getTime()) / 86400000);
export const daysInMonth = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
export const addMonths = (month: string, count: number) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1 + count, 1)).toISOString().slice(0, 7);
export const monthDistance = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
export const endOfMonth = (month: string) => `${month}-${String(daysInMonth(month)).padStart(2, "0")}`;
export const monthIndex = (month: string) => Number(month.slice(5, 7)) - 1;
export function normalized(values: number[]): number[] {
  const safe = Array.from({ length: 12 }, (_, i) => clamp(values[i] ?? 1, .05, 10));
  const average = mean(safe);
  return safe.map(n => n / average);
}
/** Acklam inverse normal approximation, sufficient for service-level policies. */
export function normalQuantile(probability: number): number {
  const p = clamp(probability, .5001, .9999);
  const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924];
  const b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857];
  const c = [-.00778489400243029, -.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878];
  const d = [.00778469570904146, .32246712907004, 2.445134137143, 3.75440866190742];
  if (p > .97575) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - .5, r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}
export function theilSen(values: number[]): number {
  const slopes: number[] = [];
  for (let i = 0; i < values.length; i++) for (let j = i + 1; j < values.length; j++) slopes.push((values[j] - values[i]) / (j - i));
  return median(slopes);
}
