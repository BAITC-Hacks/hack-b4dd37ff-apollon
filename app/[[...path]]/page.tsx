import { notFound } from "next/navigation";
import { OrderWorkspace } from "@/components/order-workspace";
import { parseRoute } from "@/lib/route";

// One workspace, addressable URLs: `/` (choose data), `/datasets/<id>` (validate + calculate), `/runs/<id>` (saved result), `?sku=<key>` (open explanation).
export default async function Home({ params, searchParams }: { params: Promise<{ path?: string[] }>; searchParams: Promise<{ sku?: string | string[] }> }) {
  const { path = [] } = await params;
  const route = parseRoute(`/${path.map(encodeURIComponent).join("/")}`);
  if (!route) notFound();
  const { sku } = await searchParams;
  return <OrderWorkspace initialRoute={route} initialSku={typeof sku === "string" ? sku : undefined}/>;
}
