"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAccount } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/", label: "Explore" },
  { href: "/launch", label: "Launch NFT" },
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

  return (
    <header className="sticky top-0 z-40 bg-[var(--paper)]/80 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6 lg:px-8">
        <Link href="/" className="group flex items-center gap-2">
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

        <nav className="ml-4 hidden items-center gap-1 sm:flex">
          {NAV.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-[2px] px-3 py-1.5 text-sm font-medium transition-colors"
                style={{
                  color: active ? "var(--vermilion)" : "var(--ink)",
                  borderBottom: active
                    ? "2px solid var(--vermilion)"
                    : "2px solid transparent",
                }}
              >
                {item.label}
              </Link>
            );
          })}
          {address ? (
            <Link
              href={`/portfolio/${address}`}
              className="rounded-[2px] px-3 py-1.5 text-sm font-medium transition-colors"
              style={{
                color: pathname.startsWith("/portfolio")
                  ? "var(--vermilion)"
                  : "var(--ink)",
              }}
            >
              Portfolio
            </Link>
          ) : null}
        </nav>

        <form onSubmit={onSearch} className="ml-auto hidden max-w-sm flex-1 md:block">
          <input
            className="field"
            style={{
              borderRadius: 9999,
              background: "var(--surface)",
              borderColor: "var(--rule)",
            }}
            placeholder="Search collections"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </form>

        <div className="ml-auto flex items-center gap-2 md:ml-3">
          <Link href="/launch" className="btn btn-primary hidden sm:inline-flex" style={{ padding: "0.5rem 1rem" }}>
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
