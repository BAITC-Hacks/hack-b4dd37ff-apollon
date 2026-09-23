import { listRunHistory } from "@/lib/repo/explorer";
import { apiError } from "@/lib/http";
export async function GET(request: Request) {
  try {
    const datasetId = new URL(request.url).searchParams.get("datasetId") ?? undefined;
    return Response.json({ history: await listRunHistory(datasetId) });
  } catch (e) { return apiError(e); }
}
