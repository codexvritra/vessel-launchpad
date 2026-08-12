import { TokenTradeClient } from "@/components/screens/TokenTradeClient";

export const dynamic = "force-dynamic";

export default async function TokenPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <TokenTradeClient token={token} />;
}
