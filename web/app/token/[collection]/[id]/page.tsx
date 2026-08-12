import { TokenClient } from "@/components/screens/TokenClient";

export const dynamic = "force-dynamic";

export default async function TokenPage({
  params,
}: {
  params: Promise<{ collection: string; id: string }>;
}) {
  const { collection, id } = await params;
  return <TokenClient collection={collection} tokenId={id} />;
}
