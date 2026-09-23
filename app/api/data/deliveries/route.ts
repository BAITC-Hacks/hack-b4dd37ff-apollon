import { listDeliveries } from "@/lib/repo/explorer";
import { AppError } from "@/lib/repo";
import { apiError, parsePageParam, parsePageSizeParam } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const url = new URL(request.url); const datasetId = url.searchParams.get("datasetId");
    if (!datasetId) throw new AppError("Choose a dataset");
    const page = await listDeliveries({ datasetId, supplier: url.searchParams.get("supplier") || undefined, search: url.searchParams.get("q") || undefined }, parsePageParam(url.searchParams.get("page")), parsePageSizeParam(url.searchParams.get("pageSize")));
    return Response.json(page);
  } catch (e) { return apiError(e); }
}
