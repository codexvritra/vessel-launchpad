import { redirect } from "next/navigation";

// The token launchpad/trade view was removed — Signapad is NFT-only.
export default function TokenRedirect() {
  redirect("/");
}
