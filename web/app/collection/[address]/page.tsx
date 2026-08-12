import { CollectionClient } from "@/components/screens/CollectionClient";

export const dynamic = "force-dynamic";

export default async function CollectionPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return <CollectionClient address={address} />;
}
