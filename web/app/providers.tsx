"use client";

import { RainbowKitProvider, lightTheme, darkTheme } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { WagmiProvider } from "wagmi";
import { getWagmiConfig } from "@/lib/wagmi";
import { ThemeProvider, useTheme } from "@/components/ThemeProvider";

function RkThemeBridge({ children }: { children: React.ReactNode }) {
  const { resolved } = useTheme();
  const accent = "#d4462a";
  const theme =
    resolved === "dark"
      ? darkTheme({ accentColor: accent, borderRadius: "small" })
      : lightTheme({ accentColor: accent, borderRadius: "small" });
  return <RainbowKitProvider theme={theme}>{children}</RainbowKitProvider>;
}

export function Providers({ children }: { children: React.ReactNode }) {
  // One QueryClient per browser session with polite polling defaults.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 15_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  // Only construct the wagmi config on the client to avoid touching wallet
  // globals during SSR/build.
  const [config] = useState(() => getWagmiConfig());

  // Guard against hydration mismatches from wallet auto-connect.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <ThemeProvider>
      <WagmiProvider config={config} reconnectOnMount={mounted}>
        <QueryClientProvider client={queryClient}>
          <RkThemeBridge>{children}</RkThemeBridge>
        </QueryClientProvider>
      </WagmiProvider>
    </ThemeProvider>
  );
}
