import { redirect } from "next/navigation";

// The token launchpad was removed — Signapad is NFT-only.
export default function TokensPage() {
  redirect("/");
}
