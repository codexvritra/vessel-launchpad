"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/launch", label: "Launch" },
];

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const { address } = useAccount();
  const [q, setQ] = useState("");

  function onSearch(e: React.FormEvent) {
    e.preventDefault();
    const v = q.trim();
    if (/^0x[0-9a-fA-F]{40}$/.test(v)) router.push(`/collection/${v}`);
  }

  function isActive(href: string) {
    return href === "/" ? pathname === "/" : pathname.startsWith(href);
  }

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--rule)] bg-[var(--paper)]/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-3 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="flex shrink-0 items-center gap-2">
          <span
            className="inline-block h-7 w-7 rounded-full"
            style={{
              background:
                "radial-gradient(circle at 32% 30%, #bcee5b, var(--vermilion) 70%)",
            }}
          />
          <span className="text-xl font-bold tracking-tight text-[var(--ink)]">
            Signapad
          </span>
          <span className="chip hidden sm:inline">Beta</span>
        </Link>

        <nav className="ml-3 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                color: isActive(item.href) ? "var(--vermilion)" : "var(--ink)",
                background: isActive(item.href) ? "var(--surface-2)" : "transparent",
              }}
            >
              {item.label}
            </Link>
          ))}
          {address ? (
            <Link
              href={`/portfolio/${address}`}
              className="rounded-full px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                color: pathname.startsWith("/portfolio")
                  ? "var(--vermilion)"
                  : "var(--ink)",
                background: pathname.startsWith("/portfolio")
                  ? "var(--surface-2)"
                  : "transparent",
              }}
            >
              My NFTs
            </Link>
          ) : null}
        </nav>

        <form onSubmit={onSearch} className="mx-auto hidden w-full max-w-sm md:block">
          <input
            className="field"
            style={{ borderRadius: 9999, background: "var(--surface)" }}
            placeholder="Search collections"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/launch"
            className="btn btn-primary hidden sm:inline-flex"
            style={{ padding: "0.5rem 1rem" }}
          >
            Launch NFT
          </Link>
          <ThemeToggle />
          <ConnectButton
            showBalance={false}
            accountStatus={{ smallScreen: "avatar", largeScreen: "full" }}
            chainStatus="icon"
          />
        </div>
      </div>
    </header>
  );
}
