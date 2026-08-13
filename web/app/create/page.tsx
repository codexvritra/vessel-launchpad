import { redirect } from "next/navigation";

// The advanced builder was removed — Signapad is a single, simple NFT launchpad.
export default function CreatePage() {
  redirect("/launch");
}
