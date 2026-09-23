import { SkuPage } from "@/components/sku-page";
export default async function SkuRoute({ params }: { params: Promise<{ runId: string; code: string }> }) {
  const { runId, code } = await params;
  return <SkuPage runId={runId} code={decodeURIComponent(code)} />;
}
