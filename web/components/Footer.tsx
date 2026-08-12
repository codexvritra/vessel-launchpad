import { CHAIN_ID, API_URL } from "@/lib/config";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-[var(--ink)]">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-4 py-6 text-xs text-[var(--muted)] sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <p className="font-serif text-sm text-[var(--ink)]">
          Signapad — the NFT that holds assets.
        </p>
        <p className="tnum">
          Chain <span className="text-[var(--ink)]">{CHAIN_ID}</span> · Indexer{" "}
          <span className="text-[var(--ink)]">{API_URL.replace(/^https?:\/\//, "")}</span>
        </p>
      </div>
    </footer>
  );
}
