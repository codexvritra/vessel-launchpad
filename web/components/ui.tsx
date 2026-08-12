import Link from "next/link";
import type { ReactNode } from "react";

/** Section header with the signature thin double-rule beneath it. */
export function SectionHeader({
  title,
  kicker,
  right,
}: {
  title: string;
  kicker?: string;
  right?: ReactNode;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-end justify-between gap-4">
        <div>
          {kicker ? <div className="label mb-1">{kicker}</div> : null}
          <h2 className="section-title text-2xl sm:text-3xl">{title}</h2>
        </div>
        {right ? <div className="shrink-0">{right}</div> : null}
      </div>
      <div className="double-rule mt-2" />
    </div>
  );
}

/** A single ledger statistic: small-caps label above a monospace figure. */
export function Stat({
  label,
  value,
  unit,
  tone = "ink",
  sub,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  tone?: "ink" | "accent" | "positive";
  sub?: ReactNode;
}) {
  const color =
    tone === "accent"
      ? "var(--vermilion)"
      : tone === "positive"
        ? "var(--teal)"
        : "var(--ink)";
  return (
    <div>
      <div className="label">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="tnum text-xl font-semibold sm:text-2xl" style={{ color }}>
          {value}
        </span>
        {unit ? (
          <span className="tnum text-xs text-[var(--muted)]">{unit}</span>
        ) : null}
      </div>
      {sub ? <div className="mt-0.5 text-xs text-[var(--muted)]">{sub}</div> : null}
    </div>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="panel flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
      <div
        aria-hidden
        className="font-serif text-4xl text-[var(--rule)]"
        style={{ letterSpacing: "0.1em" }}
      >
        ❦
      </div>
      <p className="font-serif text-lg text-[var(--ink)]">{title}</p>
      {hint ? <p className="max-w-sm text-sm text-[var(--muted)]">{hint}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

/** Deterministic certificate-style art placeholder from an address seed. */
export function ArtMark({
  seed,
  label,
  className = "",
}: {
  seed: string;
  label?: string;
  className?: string;
}) {
  const hash = hashSeed(seed);
  const hue = hash % 360;
  const rot = (hash >> 3) % 45;
  const c1 = `hsl(${hue} 45% 42%)`;
  const c2 = `hsl(${(hue + 40) % 360} 40% 30%)`;
  return (
    <div
      className={`relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ background: "var(--surface-2)" }}
    >
      <svg
        viewBox="0 0 100 100"
        className="absolute inset-0 h-full w-full opacity-90"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden
      >
        <defs>
          <linearGradient id={`g${hash}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={c1} />
            <stop offset="1" stopColor={c2} />
          </linearGradient>
        </defs>
        <rect width="100" height="100" fill={`url(#g${hash})`} />
        <g
          stroke="rgba(255,255,255,0.16)"
          strokeWidth="0.6"
          fill="none"
          transform={`rotate(${rot} 50 50)`}
        >
          {Array.from({ length: 9 }).map((_, i) => (
            <circle key={i} cx="50" cy="50" r={6 + i * 5} />
          ))}
          {Array.from({ length: 12 }).map((_, i) => {
            const a = (i / 12) * Math.PI * 2;
            return (
              <line
                key={`l${i}`}
                x1="50"
                y1="50"
                x2={50 + Math.cos(a) * 50}
                y2={50 + Math.sin(a) * 50}
              />
            );
          })}
        </g>
      </svg>
      {label ? (
        <span className="relative z-10 font-serif text-lg font-bold text-white/90 drop-shadow">
          {label}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Circular token logo. Uses the uploaded image when present, otherwise a
 * deterministic gradient disc with the token's symbol initials — the same
 * fallback pattern DEX front-ends use when a token has no logo yet.
 */
export function TokenLogo({
  symbol,
  seed,
  src,
  className = "",
}: {
  symbol: string;
  seed: string;
  src?: string;
  className?: string;
}) {
  const initials =
    (symbol || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() ||
    "?";
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={src}
        alt={symbol}
        className={`shrink-0 rounded-full object-cover ${className}`}
      />
    );
  }
  const hash = hashSeed(seed);
  const hue = hash % 360;
  const c1 = `hsl(${hue} 72% 56%)`;
  const c2 = `hsl(${(hue + 48) % 360} 70% 42%)`;
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-bold text-white ${className}`}
      style={{
        background: `linear-gradient(135deg, ${c1}, ${c2})`,
        fontSize: "0.72em",
        letterSpacing: "0.02em",
      }}
      aria-label={`${symbol} logo`}
    >
      {initials}
    </div>
  );
}

function hashSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Wash-trust indicator. `penalty` is 0..1 from the indexer's SQL model; higher
 * penalty = less trustworthy. We surface it as a trust score with a tiny meter.
 */
export function WashIndicator({
  penalty,
  compact = false,
}: {
  penalty: number;
  compact?: boolean;
}) {
  const p = Math.min(1, Math.max(0, Number.isFinite(penalty) ? penalty : 0));
  const trust = Math.round((1 - p) * 100);
  const tone =
    trust >= 75 ? "var(--teal)" : trust >= 45 ? "#b8860b" : "var(--vermilion)";
  const bars = 5;
  const filled = Math.round((trust / 100) * bars);
  return (
    <div className="flex items-center gap-1.5" title={`Wash-trust ${trust}%`}>
      <div className="flex items-center gap-0.5" aria-hidden>
        {Array.from({ length: bars }).map((_, i) => (
          <span
            key={i}
            className="inline-block h-2.5 w-1 rounded-[1px]"
            style={{
              background: i < filled ? tone : "var(--rule)",
            }}
          />
        ))}
      </div>
      {!compact ? (
        <span className="tnum text-xs" style={{ color: tone }}>
          {trust}
        </span>
      ) : null}
    </div>
  );
}

/** Small linked or plain monospace address token. */
export function AddressTag({
  address,
  href,
  short,
}: {
  address: string;
  href?: string;
  short: string;
}) {
  const inner = <span className="tnum text-sm">{short}</span>;
  if (href)
    return (
      <Link href={href} className="text-[var(--ink)] hover:text-[var(--vermilion)]">
        {inner}
      </Link>
    );
  return <span className="text-[var(--muted)]">{inner}</span>;
}
