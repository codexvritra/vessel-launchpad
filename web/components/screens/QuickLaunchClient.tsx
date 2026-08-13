"use client";

import { useState } from "react";
import Link from "next/link";
import { decodeEventLog, formatEther, parseEther, type Address } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { bcnftFactoryAbi } from "@/lib/abi";
import { BCNFT_FACTORY_ADDRESS, isConfigured } from "@/lib/config";
import { uploadCollectionImage } from "@/lib/upload";
import { SectionHeader, ArtMark } from "@/components/ui";

function safeEther(v: string): bigint {
  try {
    return v ? parseEther(v as `${number}`) : 0n;
  } catch {
    return 0n;
  }
}

/**
 * Launch a bonding-curve NFT collection: buy mints at a rising price, sell burns
 * for the current price, and early buyers profit as demand climbs. Costs a $3
 * launch fee; 1% of every buy/sell goes to the protocol wallet.
 */
export function QuickLaunchClient() {
  const { isConnected } = useAccount();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [basePrice, setBasePrice] = useState("0.001");
  const [step, setStep] = useState("0.0001");
  const [maxSupply, setMaxSupply] = useState("0");
  const [artPreview, setArtPreview] = useState<string | null>(null);
  const [metadataUri, setMetadataUri] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const ready = isConfigured(BCNFT_FACTORY_ADDRESS);

  const { data: feeData } = useReadContract({
    address: BCNFT_FACTORY_ADDRESS,
    abi: bcnftFactoryAbi,
    functionName: "launchFeeWei",
    query: { enabled: ready },
  });
  const fee = (feeData as bigint | undefined) ?? 0n;

  const { writeContract, data: hash, isPending, error, reset } = useWriteContract();
  const { isLoading: confirming, isSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash });

  // Pull the new collection address out of the factory's Launched event.
  let collection: Address | undefined;
  for (const log of receipt?.logs ?? []) {
    try {
      const d = decodeEventLog({ abi: bcnftFactoryAbi, data: log.data, topics: log.topics });
      if (d.eventName === "Launched") {
        collection = (d.args as { collection: Address }).collection;
        break;
      }
    } catch {
      /* not our event */
    }
  }

  const valid = name.trim().length > 0 && symbol.trim().length > 0 && Number(basePrice) > 0;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setArtPreview(URL.createObjectURL(f));
    setUploadErr(null);
    try {
      setUploading(true);
      const { metadataUri: md } = await uploadCollectionImage(f, { name, description: "" });
      setMetadataUri(md);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function deploy() {
    if (!valid || !ready) return;
    writeContract({
      address: BCNFT_FACTORY_ADDRESS,
      abi: bcnftFactoryAbi,
      functionName: "launch",
      args: [
        name,
        symbol,
        safeEther(basePrice),
        safeEther(step),
        BigInt(maxSupply || "0"),
        metadataUri,
      ],
      value: fee,
    });
  }

  return (
    <div className="mx-auto max-w-xl">
      <SectionHeader
        kicker="Bonding-curve NFT"
        title="Launch a collection"
        right={<span className="chip">Launch fee {formatEther(fee)} Ξ (~$3)</span>}
      />

      <div className="panel space-y-4 p-5">
        <div className="flex gap-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-[12px] border border-[var(--rule)]">
            {artPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={artPreview} alt="art" className="h-full w-full object-cover" />
            ) : (
              <ArtMark seed={symbol || name || "art"} label={symbol || "ART"} className="h-full w-full" />
            )}
          </div>
          <div className="flex-1">
            <div className="label mb-1">Collection image</div>
            <input type="file" accept="image/*" className="field" onChange={onFile} />
            {uploading ? (
              <p className="mt-1 text-xs text-[var(--muted)]">Uploading…</p>
            ) : metadataUri ? (
              <p className="mt-1 text-xs text-[var(--teal)]">Image uploaded ✓</p>
            ) : (
              <p className="mt-1 text-xs text-[var(--muted)]">Choose an image — uploaded automatically.</p>
            )}
            {uploadErr ? <p className="mt-1 text-xs text-[var(--vermilion)]">{uploadErr}</p> : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="label mb-1">Name *</div>
            <input className="field" placeholder="My Collection" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <div className="label mb-1">Symbol *</div>
            <input className="field field-mono" placeholder="MYC" maxLength={11} value={symbol} onChange={(e) => setSymbol(e.target.value.toUpperCase())} />
          </label>
          <label className="block">
            <div className="label mb-1">Starting price (ETH) *</div>
            <input className="field field-mono" inputMode="decimal" value={basePrice} onChange={(e) => setBasePrice(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <label className="block">
            <div className="label mb-1">Price step / mint (ETH)</div>
            <input className="field field-mono" inputMode="decimal" value={step} onChange={(e) => setStep(e.target.value.replace(/[^0-9.]/g, ""))} />
          </label>
          <label className="block sm:col-span-2">
            <div className="label mb-1">Max supply (0 = unlimited)</div>
            <input className="field field-mono" inputMode="numeric" value={maxSupply} onChange={(e) => setMaxSupply(e.target.value.replace(/[^0-9]/g, ""))} />
          </label>
        </div>

        <div className="certificate p-3 text-xs text-[var(--muted)]">
          Mint #1 costs <span className="tnum text-[var(--ink)]">{basePrice || "0"} Ξ</span>; each mint
          then costs <span className="tnum text-[var(--ink)]">+{step || "0"} Ξ</span> more. Holders can
          sell back at the current price — early buyers profit as the price climbs.
        </div>

        {!ready ? (
          <p className="text-xs text-[var(--muted)]">Bonding-curve factory not configured on this deployment.</p>
        ) : isSuccess ? (
          <div className="panel p-3 text-sm" style={{ borderLeft: "3px solid var(--teal)" }}>
            <p className="font-semibold">Launched 🎉</p>
            {collection ? (
              <Link className="tnum text-[var(--vermilion)] underline" href={`/c/${collection}`}>
                Open the buy/sell page →
              </Link>
            ) : (
              <p className="tnum text-xs">Tx {hash}</p>
            )}
            <button className="btn mt-2" onClick={() => reset()}>Launch another</button>
          </div>
        ) : !isConnected ? (
          <ConnectButton />
        ) : (
          <button className="btn btn-primary w-full" disabled={!valid || isPending || confirming || uploading} onClick={deploy}>
            {isPending ? "Confirm in wallet…" : confirming ? "Launching…" : `Launch (${formatEther(fee)} Ξ fee)`}
          </button>
        )}
        {error ? <p className="text-xs text-[var(--vermilion)]">{error.message.split("\n")[0]}</p> : null}
      </div>
    </div>
  );
}
