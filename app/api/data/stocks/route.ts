import { listStockHistory } from "@/lib/repo/explorer";
import { AppError } from "@/lib/repo";
import { apiError } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url); const datasetId = url.searchParams.get("datasetId");
    if (!datasetId) throw new AppError("Choose a dataset");
    const page = await listStockHistory({ datasetId, supplier: url.searchParams.get("supplier") || undefined, search: url.searchParams.get("q") || undefined }, Number(url.searchParams.get("page") || 0), Number(url.searchParams.get("pageSize") || 50));
    return Response.json(page);
  } catch (e) { return apiError(e); }
}
