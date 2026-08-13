import { BuySellClient } from "@/components/screens/BuySellClient";

export const dynamic = "force-dynamic";

export default async function BondingCurvePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return <BuySellClient address={address} />;
}
