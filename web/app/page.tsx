import { ExploreClient } from "@/components/screens/ExploreClient";

// Live rankings; never statically prerender against the indexer.
export const dynamic = "force-dynamic";

export default function HomePage() {
  return <ExploreClient />;
}
