"use client";

import { useEffect, useState } from "react";
import { useTheme } from "./ThemeProvider";

export function ThemeToggle() {
  const { resolved, toggle } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle color theme"
      title={mounted ? `Theme: ${resolved}` : "Theme"}
      className="btn"
      style={{ padding: "0.5rem 0.6rem", background: "var(--surface)" }}
    >
      <span aria-hidden className="text-sm">
        {mounted && resolved === "dark" ? "◐" : "◑"}
      </span>
    </button>
  );
}
