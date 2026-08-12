import { ProfileClient } from "@/components/screens/ProfileClient";

export const dynamic = "force-dynamic";

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  return <ProfileClient address={address} />;
}
