import { PortfolioClient } from "@/components/screens/PortfolioClient";

export const dynamic = "force-dynamic";

export default async function PortfolioPage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return <PortfolioClient address={address} />;
}
