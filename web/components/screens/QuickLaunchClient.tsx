"use client";

import { useState } from "react";
import Link from "next/link";
import { formatEther, parseEther, zeroAddress, zeroHash, type Address } from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { collectionFactoryAbi } from "@/lib/abi";
import { FACTORY_ADDRESS, isConfigured } from "@/lib/config";
import { UPLOAD_ENABLED, uploadCollectionImage } from "@/lib/upload";
import { SectionHeader, ArtMark } from "@/components/ui";

/**
 * Quick Launch — the fast, mass-market path: upload art, name it, set supply +
 * price, deploy. A plain ERC-721A art collection (no funded wallets, no coin
 * market), so it's simple and carries none of the asset-backed complexity. For the
 * full featured flow (phases, allowlist, TBA funding, Dutch auction, coin market),
 * use /create.
 */
export function QuickLaunchClient() {
  const { isConnected } = useAccount();
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");
  const [maxSupply, setMaxSupply] = useState("1000");
  const [free, setFree] = useState(false);
  const [price, setPrice] = useState("0.001");
  const [description, setDescription] = useState("");
  const [imageUri, setImageUri] = useState("");
  const [metadataUri, setMetadataUri] = useState("");
  const [artPreview, setArtPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);

  const factoryReady = isConfigured(FACTORY_ADDRESS);

  const { data: deployFee } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: collectionFactoryAbi,
    functionName: "deployFee",
    query: { enabled: factoryReady },
  });
  const fee = (deployFee as bigint | undefined) ?? 0n;

  const { writeContract, data: txHash, isPending, error, reset } = useWriteContract();
  const { isLoading: isConfirming, isSuccess, data: receipt } =
    useWaitForTransactionReceipt({ hash: txHash });
  const collectionAddress =
    (receipt?.logs?.[0]?.address as Address | undefined) ?? undefined;

  const valid = name.trim().length > 0 && symbol.trim().length > 0 && Number(maxSupply) > 0;

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setArtPreview(URL.createObjectURL(f));
    setUploadErr(null);
    if (!UPLOAD_ENABLED) return; // preview only; paste a link in the field below
    try {
      setUploading(true);
      const { imageUri: img, metadataUri: md } = await uploadCollectionImage(f, {
        name,
        description,
      });
      setImageUri(img);
      setMetadataUri(md);
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function deploy() {
    if (!valid || !factoryReady) return;
    const now = Math.floor(Date.now() / 1000);
    const p = free ? 0n : safeEther(price);
    const config = {
      name,
      symbol,
      maxSupply: BigInt(maxSupply || "0"),
      mintPrice: p,
      royaltyBps: 500n, // 5% default
      tbaFundingBps: 0, // plain art — no funded wallets
      backingAsset: zeroAddress,
      mintPhases: [
        {
          merkleRoot: zeroHash,
          price: p,
          endPrice: 0n,
          startTime: BigInt(now),
          endTime: BigInt(now + 365 * 24 * 3600),
          perWalletCap: 0,
          maxMintable: 0,
        },
      ],
    } as const;

    writeContract({
      address: FACTORY_ADDRESS,
      abi: collectionFactoryAbi,
      functionName: "createCollection",
      args: [config, "", (metadataUri || imageUri).trim(), false],
      value: fee,
    });
  }

  return (
    <div className="mx-auto max-w-xl">
      <SectionHeader
        kicker="Quick Launch"
        title="Deploy a collection in 30 seconds"
        right={
          fee > 0n ? (
            <span className="chip">Deploy fee {formatEther(fee)} Ξ</span>
          ) : (
            <span className="chip chip-positive">Free deploy</span>
          )
        }
      />

      <div className="panel space-y-4 p-5">
        <div className="flex gap-4">
          <div className="h-24 w-24 shrink-0 overflow-hidden rounded-[2px] border border-[var(--rule)]">
            {artPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={artPreview} alt="art" className="h-full w-full object-cover" />
            ) : (
              <ArtMark seed={symbol || name || "art"} label={symbol || "ART"} className="h-full w-full" />
            )}
          </div>
          <div className="flex-1">
            <div className="label mb-1">Collection image</div>
            {UPLOAD_ENABLED ? (
              <>
                <input
                  type="file"
                  accept="image/*"
                  className="field"
                  onChange={onFile}
                />
                {uploading ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Uploading to IPFS…
                  </p>
                ) : imageUri ? (
                  <p className="mt-1 text-xs text-[var(--teal)]">
                    Image uploaded ✓
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Pick a file — it&apos;s uploaded automatically.
                  </p>
                )}
              </>
            ) : (
              <>
                <input
                  className="field field-mono"
                  placeholder="Image URL (https:// or ipfs://)"
                  value={imageUri}
                  onChange={(e) => setImageUri(e.target.value)}
                />
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Paste a link to your art. Direct file upload turns on once an
                  IPFS (Pinata) key is added.
                </p>
              </>
            )}
            {uploadErr ? (
              <p className="mt-1 text-xs text-[var(--vermilion)]">{uploadErr}</p>
            ) : null}
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <div className="label mb-1">Name *</div>
            <input className="field" placeholder="My Collection" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="block">
            <div className="label mb-1">Symbol *</div>
            <input
              className="field field-mono"
              placeholder="MYC"
              maxLength={11}
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            />
          </label>
          <label className="block">
            <div className="label mb-1">Max supply *</div>
            <input
              className="field field-mono"
              inputMode="numeric"
              value={maxSupply}
              onChange={(e) => setMaxSupply(e.target.value.replace(/[^0-9]/g, ""))}
            />
          </label>
          <label className="block">
            <div className="label mb-1 flex items-center justify-between">
              <span>Mint price</span>
              <label className="flex cursor-pointer items-center gap-1 text-xs">
                <input type="checkbox" className="accent-[var(--vermilion)]" checked={free} onChange={(e) => setFree(e.target.checked)} />
                Free
              </label>
            </div>
            <input
              className="field field-mono"
              inputMode="decimal"
              disabled={free}
              value={free ? "0" : price}
              onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))}
            />
          </label>
        </div>

        <label className="block">
          <div className="label mb-1">Description (optional)</div>
          <textarea className="field" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>

        {!factoryReady ? (
          <p className="text-xs text-[var(--muted)]">
            No factory configured (<code>NEXT_PUBLIC_FACTORY</code>). Deploy disabled.
          </p>
        ) : null}

        {isSuccess ? (
          <div className="panel p-3 text-sm" style={{ borderLeft: "3px solid var(--teal)" }}>
            <p className="font-semibold">Deployed 🎉</p>
            {collectionAddress ? (
              <Link className="tnum text-[var(--vermilion)] underline" href={`/collection/${collectionAddress}`}>
                Open your shareable mint page →
              </Link>
            ) : (
              <p className="tnum text-xs">Tx {txHash}</p>
            )}
            <button className="btn mt-2" onClick={() => reset()}>Launch another</button>
          </div>
        ) : !isConnected ? (
          <ConnectButton />
        ) : (
          <button
            className="btn btn-primary w-full"
            disabled={!valid || isPending || isConfirming || uploading}
            onClick={deploy}
          >
            {isPending
              ? "Confirm in wallet…"
              : isConfirming
                ? "Deploying…"
                : fee > 0n
                  ? `Deploy collection (${formatEther(fee)} Ξ)`
                  : "Deploy collection"}
          </button>
        )}
        {error ? <p className="text-xs text-[var(--vermilion)]">{error.message.split("\n")[0]}</p> : null}

        <p className="border-t border-[var(--rule)] pt-3 text-xs text-[var(--muted)]">
          One public mint phase · a shareable mint page is created automatically,
          so anyone can mint your supply.
        </p>
      </div>
    </div>
  );
}

function safeEther(v: string): bigint {
  try {
    return v ? parseEther(v as `${number}`) : 0n;
  } catch {
    return 0n;
  }
}
