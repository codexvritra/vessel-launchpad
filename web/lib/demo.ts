/**
 * Sample tokens used to populate the Explore shelves when no live indexer data
 * is available (local dev without a chain). Clearly-fictional preview data — it
 * lets the UI render the full pools.trade-style layout (cards, FDV, % change,
 * volume, holders) so the design can be evaluated end-to-end. Live data from the
 * indexer always takes precedence over this.
 */
export type DisplayToken = {
  address: string;
  name: string;
  symbol: string;
  ageLabel: string;
  ageMinutes: number; // for "New" sorting
  fdvUsd: number;
  changePct: number; // 24h, +up / -down
  volumeUsd: number;
  holders: number;
  graduationPct?: number; // 0..100 for "Near graduation"
};

export const DEMO_TOKENS: DisplayToken[] = [
  { address: "0xB0a7f1e0000000000000000000000000000f0001", name: "Frogger", symbol: "FROG", ageLabel: "12d", ageMinutes: 17280, fdvUsd: 4183866, changePct: -11.06, volumeUsd: 3447134, holders: 12951, graduationPct: 100 },
  { address: "0xB0a7f1e0000000000000000000000000000f0002", name: "MoonRabbit", symbol: "MRBT", ageLabel: "3d", ageMinutes: 4320, fdvUsd: 824886, changePct: 16.33, volumeUsd: 228221, holders: 1820, graduationPct: 100 },
  { address: "0xB0a7f1e0000000000000000000000000000f0003", name: "TurboNewt", symbol: "TNEWT", ageLabel: "1d", ageMinutes: 1440, fdvUsd: 774306, changePct: 149.3, volumeUsd: 415888, holders: 2490, graduationPct: 100 },
  { address: "0xB0a7f1e0000000000000000000000000000f0004", name: "HoodCat", symbol: "HCAT", ageLabel: "6d", ageMinutes: 8640, fdvUsd: 742893, changePct: -12.04, volumeUsd: 578521, holders: 1525, graduationPct: 100 },
  { address: "0xB0a7f1e0000000000000000000000000000f0005", name: "GreenPill", symbol: "PILL", ageLabel: "1h", ageMinutes: 60, fdvUsd: 653249, changePct: 103.5, volumeUsd: 155795, holders: 265, graduationPct: 74 },
  { address: "0xB0a7f1e0000000000000000000000000000f0006", name: "Sushiro", symbol: "SUSH", ageLabel: "7d", ageMinutes: 10080, fdvUsd: 571864, changePct: 44.6, volumeUsd: 308595, holders: 866, graduationPct: 100 },
  { address: "0xB0a7f1e0000000000000000000000000000f0007", name: "DiamondPaws", symbol: "DPAW", ageLabel: "6d", ageMinutes: 8640, fdvUsd: 343942, changePct: -18.16, volumeUsd: 395609, holders: 1779, graduationPct: 100 },
  { address: "0xB0a7f1e0000000000000000000000000000f0008", name: "BasedDuck", symbol: "DUCK", ageLabel: "3d", ageMinutes: 4320, fdvUsd: 198857, changePct: 209.8, volumeUsd: 243665, holders: 740, graduationPct: 92 },
  { address: "0xB0a7f1e0000000000000000000000000000f0009", name: "PixelApe", symbol: "PXAPE", ageLabel: "7d", ageMinutes: 10080, fdvUsd: 206322, changePct: -7.49, volumeUsd: 96051, holders: 1941, graduationPct: 100 },
  { address: "0xB0a7f1e000000000000000000000000000f00010", name: "RoboSeal", symbol: "SEAL", ageLabel: "4d", ageMinutes: 5760, fdvUsd: 223341, changePct: -33.57, volumeUsd: 192717, holders: 1396, graduationPct: 100 },
  { address: "0xB0a7f1e000000000000000000000000000f00011", name: "NanoWhale", symbol: "WHALE", ageLabel: "29m", ageMinutes: 29, fdvUsd: 88997, changePct: 6.4, volumeUsd: 42778, holders: 221, graduationPct: 38 },
  { address: "0xB0a7f1e000000000000000000000000000f00012", name: "Vessel", symbol: "VSSL", ageLabel: "2h", ageMinutes: 120, fdvUsd: 311000, changePct: 0.0, volumeUsd: 51120, holders: 402, graduationPct: 61 },
  { address: "0xB0a7f1e000000000000000000000000000f00013", name: "SolarNwt", symbol: "SOLN", ageLabel: "9d", ageMinutes: 12960, fdvUsd: 142880, changePct: 12.7, volumeUsd: 88400, holders: 611, graduationPct: 100 },
  { address: "0xB0a7f1e000000000000000000000000000f00014", name: "GigaMoth", symbol: "MOTH", ageLabel: "5h", ageMinutes: 300, fdvUsd: 77420, changePct: -4.2, volumeUsd: 30110, holders: 188, graduationPct: 44 },
  { address: "0xB0a7f1e000000000000000000000000000f00015", name: "CandleWick", symbol: "WICK", ageLabel: "2d", ageMinutes: 2880, fdvUsd: 265900, changePct: 27.9, volumeUsd: 176300, holders: 980, graduationPct: 100 },
  { address: "0xB0a7f1e000000000000000000000000000f00016", name: "ZenGoblin", symbol: "ZGOB", ageLabel: "8h", ageMinutes: 480, fdvUsd: 54210, changePct: 61.2, volumeUsd: 61200, holders: 344, graduationPct: 52 },
];

export type ExploreTab = "trending" | "new" | "top" | "graduating";

export const EXPLORE_TABS: { key: ExploreTab; label: string }[] = [
  { key: "trending", label: "Trending" },
  { key: "new", label: "New" },
  { key: "top", label: "Top" },
  { key: "graduating", label: "Near graduation" },
];

export function sortTokens(tokens: DisplayToken[], tab: ExploreTab): DisplayToken[] {
  const t = [...tokens];
  switch (tab) {
    case "new":
      return t.sort((a, b) => a.ageMinutes - b.ageMinutes);
    case "top":
      return t.sort((a, b) => b.fdvUsd - a.fdvUsd);
    case "graduating":
      return t
        .filter((x) => (x.graduationPct ?? 100) < 100)
        .sort((a, b) => (b.graduationPct ?? 0) - (a.graduationPct ?? 0));
    case "trending":
    default:
      return t.sort((a, b) => b.volumeUsd - a.volumeUsd);
  }
}

/** Compact USD formatter: $4.2M, $824.9K, $612. */
export function formatUsd(n: number): string {
  if (!isFinite(n)) return "$0";
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}
