"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  isAddress,
  parseEther,
  zeroAddress,
  zeroHash,
  type Address,
} from "viem";
import {
  useAccount,
  useReadContract,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { collectionFactoryAbi } from "@/lib/abi";
import { registerAllowlist } from "@/lib/api";
import { computeMerkleRoot, parseAddressList } from "@/lib/merkle";
import { FACTORY_ADDRESS, isConfigured } from "@/lib/config";
import { SectionHeader } from "@/components/ui";
import { ArtMark } from "@/components/ui";

// ---- Form model -------------------------------------------------------------

type PhaseForm = {
  id: string;
  kind: "public" | "allowlist";
  pricing: "fixed" | "dutch"; // Dutch = descending-price auction
  merkleRoot: string; // advanced: raw root when no address list is provided
  allowlistAddresses: string; // newline/comma separated addresses
  price: string; // ETH — fixed price, or the START price of a Dutch auction
  floorPrice: string; // ETH — Dutch-auction floor (endPrice)
  start: string; // datetime-local
  end: string;
  perWalletCap: string;
  maxMintable: string;
};

type FormState = {
  name: string;
  symbol: string;
  description: string;
  baseTokenURI: string;
  contractURI: string;
  artPreview: string | null;
  maxSupply: string;
  mintPrice: string; // ETH
  royaltyPct: string;
  tbaFundingPct: string;
  backingKind: "eth" | "erc20";
  backingAsset: string;
  enableCoinMarket: boolean;
  phases: PhaseForm[];
};

const STEPS = [
  "Artwork & identity",
  "Supply & economics",
  "Mint phases",
  "Vessel funding",
  "Review & deploy",
] as const;

function newPhase(kind: PhaseForm["kind"]): PhaseForm {
  return {
    id: crypto.randomUUID(),
    kind,
    pricing: "fixed",
    merkleRoot: "",
    allowlistAddresses: "",
    price: "",
    floorPrice: "",
    start: "",
    end: "",
    perWalletCap: "5",
    maxMintable: "",
  };
}

const INITIAL: FormState = {
  name: "",
  symbol: "",
  description: "",
  baseTokenURI: "",
  contractURI: "",
  artPreview: null,
  maxSupply: "1000",
  mintPrice: "0.05",
  royaltyPct: "5",
  tbaFundingPct: "40",
  backingKind: "eth",
  backingAsset: zeroAddress,
  enableCoinMarket: false,
  phases: [newPhase("public")],
};

// ---- Helpers ----------------------------------------------------------------

function toUnix(dt: string): bigint {
  if (!dt) return 0n;
  const ms = Date.parse(dt);
  return Number.isFinite(ms) ? BigInt(Math.floor(ms / 1000)) : 0n;
}

function safeParseEther(v: string): bigint {
  try {
    if (!v || Number(v) < 0) return 0n;
    return parseEther(v as `${number}`);
  } catch {
    return 0n;
  }
}

// ---- Component --------------------------------------------------------------

export function CreateClient() {
  const { isConnected } = useAccount();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>(INITIAL);

  const {
    writeContract,
    data: txHash,
    isPending,
    error: writeError,
    reset,
  } = useWriteContract();
  const {
    isLoading: isConfirming,
    isSuccess,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const backingAssetAddr: Address =
    form.backingKind === "eth"
      ? zeroAddress
      : isAddress(form.backingAsset.trim())
        ? (form.backingAsset.trim() as Address)
        : zeroAddress;

  const perTokenFunding = useMemo(() => {
    const price = Number(form.mintPrice) || 0;
    const bps = (Number(form.tbaFundingPct) || 0) * 100;
    return (price * bps) / 10000;
  }, [form.mintPrice, form.tbaFundingPct]);

  const validity = useMemo(() => validate(form), [form]);
  const factoryReady = isConfigured(FACTORY_ADDRESS);

  const { data: deployFeeData } = useReadContract({
    address: FACTORY_ADDRESS,
    abi: collectionFactoryAbi,
    functionName: "deployFee",
    query: { enabled: factoryReady },
  });
  const deployFee = (deployFeeData as bigint | undefined) ?? 0n;

  const collectionAddress =
    (receipt?.logs?.[0]?.address as Address | undefined) ?? undefined;

  // Resolve each phase's Merkle root: prefer a root computed from the pasted
  // address list, fall back to an advanced raw root, else zero (public).
  function phaseRoot(p: PhaseForm): `0x${string}` {
    if (p.kind !== "allowlist") return zeroHash;
    const computed = computeMerkleRoot(parseAddressList(p.allowlistAddresses));
    if (computed) return computed;
    if (p.merkleRoot.trim().startsWith("0x")) return p.merkleRoot.trim() as `0x${string}`;
    return zeroHash;
  }

  function handleDeploy() {
    if (!validity.ok || !factoryReady) return;
    const config = {
      name: form.name,
      symbol: form.symbol,
      maxSupply: BigInt(form.maxSupply || "0"),
      mintPrice: safeParseEther(form.mintPrice),
      royaltyBps: BigInt(Math.round((Number(form.royaltyPct) || 0) * 100)),
      tbaFundingBps: Math.round((Number(form.tbaFundingPct) || 0) * 100),
      backingAsset: backingAssetAddr,
      mintPhases: form.phases.map((p) => ({
        merkleRoot: phaseRoot(p),
        price: safeParseEther(p.price || form.mintPrice),
        endPrice: p.pricing === "dutch" ? safeParseEther(p.floorPrice) : 0n,
        startTime: toUnix(p.start),
        endTime: toUnix(p.end),
        perWalletCap: Number(p.perWalletCap) || 0,
        maxMintable: Number(p.maxMintable) || 0,
      })),
    } as const;

    writeContract({
      address: FACTORY_ADDRESS,
      abi: collectionFactoryAbi,
      functionName: "createCollection",
      args: [config, form.baseTokenURI, form.contractURI, form.enableCoinMarket],
      value: deployFee,
    });
  }

  // After the collection is live on-chain, register each allowlist's address list
  // with the services layer so minters can fetch proofs. The service validates
  // the list against the committed on-chain root, so this needs no extra auth.
  const [allowlistStatus, setAllowlistStatus] = useState<string | null>(null);
  useEffect(() => {
    if (!isSuccess || !collectionAddress) return;
    const lists = form.phases
      .map((p, i) => ({ addrs: parseAddressList(p.allowlistAddresses), i, kind: p.kind }))
      .filter((x) => x.kind === "allowlist" && x.addrs.length > 0);
    if (lists.length === 0) return;
    let cancelled = false;
    (async () => {
      let ok = 0;
      for (const { addrs, i } of lists) {
        const res = await registerAllowlist(collectionAddress, i, addrs);
        if (res.root) ok++;
      }
      if (!cancelled)
        setAllowlistStatus(`Registered ${ok}/${lists.length} allowlist(s) for proof serving.`);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSuccess, collectionAddress]);

  return (
    <div>
      <SectionHeader
        kicker="No-code deployment"
        title="Issue a Collection"
        right={
          <span className="label">
            Step {step + 1} / {STEPS.length}
          </span>
        }
      />

      <Stepper step={step} onJump={setStep} />

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_20rem]">
        <div className="panel p-5">
          {step === 0 && <StepArtwork form={form} set={set} />}
          {step === 1 && <StepEconomics form={form} set={set} />}
          {step === 2 && (
            <StepPhases
              form={form}
              onChange={(phases) => set("phases", phases)}
            />
          )}
          {step === 3 && (
            <StepFunding
              form={form}
              set={set}
              perTokenFunding={perTokenFunding}
            />
          )}
          {step === 4 && (
            <StepReview
              form={form}
              perTokenFunding={perTokenFunding}
              factoryReady={factoryReady}
              validity={validity}
              isConnected={isConnected}
              isPending={isPending}
              isConfirming={isConfirming}
              isSuccess={isSuccess}
              txHash={txHash}
              collectionAddress={collectionAddress}
              allowlistStatus={allowlistStatus}
              writeError={writeError?.message ?? null}
              onDeploy={handleDeploy}
              onReset={() => {
                reset();
                setAllowlistStatus(null);
              }}
            />
          )}

          <div className="mt-6 flex items-center justify-between border-t border-[var(--rule)] pt-4">
            <button
              className="btn"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              ← Back
            </button>
            {step < STEPS.length - 1 ? (
              <button
                className="btn btn-primary"
                onClick={() => setStep((s) => Math.min(STEPS.length - 1, s + 1))}
              >
                Continue →
              </button>
            ) : (
              <span className="label">
                {validity.ok ? "Ready to deploy" : validity.reason}
              </span>
            )}
          </div>
        </div>

        <PreviewPanel
          form={form}
          perTokenFunding={perTokenFunding}
          backingAssetAddr={backingAssetAddr}
        />
      </div>
    </div>
  );
}

// ---- Validation -------------------------------------------------------------

function validate(f: FormState): { ok: boolean; reason: string } {
  if (!f.name.trim()) return { ok: false, reason: "Name required" };
  if (!f.symbol.trim()) return { ok: false, reason: "Symbol required" };
  if (!(Number(f.maxSupply) > 0)) return { ok: false, reason: "Supply > 0" };
  if (Number(f.mintPrice) < 0) return { ok: false, reason: "Bad price" };
  if (f.phases.length === 0) return { ok: false, reason: "Add a phase" };
  const bps = Number(f.tbaFundingPct);
  if (!(bps >= 0 && bps <= 100)) return { ok: false, reason: "Funding 0–100%" };
  if (
    f.backingKind === "erc20" &&
    !isAddress(f.backingAsset.trim())
  )
    return { ok: false, reason: "Bad backing asset" };
  return { ok: true, reason: "" };
}

// ---- Stepper ----------------------------------------------------------------

function Stepper({
  step,
  onJump,
}: {
  step: number;
  onJump: (n: number) => void;
}) {
  return (
    <ol className="flex flex-wrap gap-x-1 gap-y-2 text-sm">
      {STEPS.map((label, i) => {
        const active = i === step;
        const done = i < step;
        return (
          <li key={label} className="flex items-center">
            <button
              onClick={() => onJump(i)}
              className="flex items-center gap-2 rounded-[2px] px-2 py-1"
              style={{ color: active ? "var(--vermilion)" : "var(--muted)" }}
            >
              <span
                className="tnum flex h-5 w-5 items-center justify-center rounded-full border text-xs"
                style={{
                  borderColor: active
                    ? "var(--vermilion)"
                    : done
                      ? "var(--teal)"
                      : "var(--rule)",
                  background: done ? "var(--teal)" : "transparent",
                  color: done ? "#fff" : "inherit",
                }}
              >
                {done ? "✓" : i + 1}
              </span>
              <span className={active ? "font-semibold" : ""}>{label}</span>
            </button>
            {i < STEPS.length - 1 ? (
              <span className="px-1 text-[var(--rule)]">—</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

// ---- Step 1: Artwork --------------------------------------------------------

function StepArtwork({
  form,
  set,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    set("artPreview", url);
  }
  return (
    <div className="space-y-4">
      <Heading n={1} title="Artwork & identity" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Collection name" required>
          <input
            className="field"
            placeholder="Almanac Vessels"
            value={form.name}
            onChange={(e) => set("name", e.target.value)}
          />
        </Field>
        <Field label="Symbol" required>
          <input
            className="field field-mono"
            placeholder="VSSL"
            maxLength={11}
            value={form.symbol}
            onChange={(e) => set("symbol", e.target.value.toUpperCase())}
          />
        </Field>
      </div>
      <Field label="Description">
        <textarea
          className="field"
          rows={3}
          placeholder="A limited register of funded vessels…"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
        />
      </Field>
      <Field label="Artwork" hint="Preview only — pin your art and pass its URI below.">
        <input type="file" accept="image/*" className="field" onChange={onFile} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Base token URI" hint="ipfs://… or https://…/metadata/">
          <input
            className="field field-mono"
            placeholder="ipfs://…/"
            value={form.baseTokenURI}
            onChange={(e) => set("baseTokenURI", e.target.value)}
          />
        </Field>
        <Field label="Contract URI">
          <input
            className="field field-mono"
            placeholder="ipfs://…/contract.json"
            value={form.contractURI}
            onChange={(e) => set("contractURI", e.target.value)}
          />
        </Field>
      </div>
    </div>
  );
}

// ---- Step 2: Economics ------------------------------------------------------

function StepEconomics({
  form,
  set,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
}) {
  return (
    <div className="space-y-4">
      <Heading n={2} title="Supply & economics" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Max supply" required>
          <input
            className="field field-mono"
            inputMode="numeric"
            value={form.maxSupply}
            onChange={(e) =>
              set("maxSupply", e.target.value.replace(/[^0-9]/g, ""))
            }
          />
        </Field>
        <Field label="Mint price" hint="ETH">
          <input
            className="field field-mono"
            inputMode="decimal"
            value={form.mintPrice}
            onChange={(e) =>
              set("mintPrice", e.target.value.replace(/[^0-9.]/g, ""))
            }
          />
        </Field>
        <Field label="Royalty" hint="% on secondary">
          <input
            className="field field-mono"
            inputMode="decimal"
            value={form.royaltyPct}
            onChange={(e) =>
              set("royaltyPct", e.target.value.replace(/[^0-9.]/g, ""))
            }
          />
        </Field>
      </div>
      <p className="text-sm text-[var(--muted)]">
        Royalty is stored on-chain as basis points (
        <span className="tnum">
          {Math.round((Number(form.royaltyPct) || 0) * 100)}
        </span>{" "}
        bps). The mint price is the primary sale; the funding split below decides
        how much of it lands in each token&apos;s wallet.
      </p>
    </div>
  );
}

// ---- Step 3: Phases ---------------------------------------------------------

function StepPhases({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (phases: PhaseForm[]) => void;
}) {
  const phases = form.phases;
  const update = (id: string, patch: Partial<PhaseForm>) =>
    onChange(phases.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const remove = (id: string) => onChange(phases.filter((p) => p.id !== id));

  return (
    <div className="space-y-4">
      <Heading n={3} title="Mint phases" />
      <div className="flex gap-2">
        <button
          className="btn"
          onClick={() => onChange([...phases, newPhase("allowlist")])}
        >
          + Allowlist phase
        </button>
        <button
          className="btn"
          onClick={() => onChange([...phases, newPhase("public")])}
        >
          + Public phase
        </button>
      </div>

      <div className="space-y-4">
        {phases.map((p, i) => (
          <div key={p.id} className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="tnum label">Phase {i}</span>
                <select
                  className="field field-mono"
                  style={{ width: "auto", padding: "0.3rem 0.5rem" }}
                  value={p.kind}
                  onChange={(e) =>
                    update(p.id, {
                      kind: e.target.value as PhaseForm["kind"],
                    })
                  }
                >
                  <option value="public">Public</option>
                  <option value="allowlist">Allowlist</option>
                </select>
                <select
                  className="field field-mono"
                  style={{ width: "auto", padding: "0.3rem 0.5rem" }}
                  value={p.pricing}
                  onChange={(e) =>
                    update(p.id, {
                      pricing: e.target.value as PhaseForm["pricing"],
                    })
                  }
                >
                  <option value="fixed">Fixed price</option>
                  <option value="dutch">Dutch auction</option>
                </select>
              </div>
              {phases.length > 1 ? (
                <button
                  className="text-sm text-[var(--vermilion)]"
                  onClick={() => remove(p.id)}
                >
                  Remove
                </button>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field
                label={p.pricing === "dutch" ? "Start price" : "Price"}
                hint="ETH"
              >
                <input
                  className="field field-mono"
                  inputMode="decimal"
                  placeholder={form.mintPrice}
                  value={p.price}
                  onChange={(e) =>
                    update(p.id, {
                      price: e.target.value.replace(/[^0-9.]/g, ""),
                    })
                  }
                />
              </Field>
              {p.pricing === "dutch" ? (
                <Field label="Floor price" hint="ETH — decays to this">
                  <input
                    className="field field-mono"
                    inputMode="decimal"
                    placeholder="0.05"
                    value={p.floorPrice}
                    onChange={(e) =>
                      update(p.id, {
                        floorPrice: e.target.value.replace(/[^0-9.]/g, ""),
                      })
                    }
                  />
                </Field>
              ) : null}
              <Field label="Per-wallet cap">
                <input
                  className="field field-mono"
                  inputMode="numeric"
                  value={p.perWalletCap}
                  onChange={(e) =>
                    update(p.id, {
                      perWalletCap: e.target.value.replace(/[^0-9]/g, ""),
                    })
                  }
                />
              </Field>
              <Field label="Max mintable" hint="0 = supply">
                <input
                  className="field field-mono"
                  inputMode="numeric"
                  value={p.maxMintable}
                  onChange={(e) =>
                    update(p.id, {
                      maxMintable: e.target.value.replace(/[^0-9]/g, ""),
                    })
                  }
                />
              </Field>
              {p.kind === "allowlist" ? (
                <div className="sm:col-span-2 lg:col-span-4">
                  <AllowlistField phase={p} update={update} />
                </div>
              ) : (
                <div className="hidden lg:block" />
              )}
              <Field label="Starts">
                <input
                  type="datetime-local"
                  className="field field-mono"
                  value={p.start}
                  onChange={(e) => update(p.id, { start: e.target.value })}
                />
              </Field>
              <Field label="Ends">
                <input
                  type="datetime-local"
                  className="field field-mono"
                  value={p.end}
                  onChange={(e) => update(p.id, { end: e.target.value })}
                />
              </Field>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AllowlistField({
  phase,
  update,
}: {
  phase: PhaseForm;
  update: (id: string, patch: Partial<PhaseForm>) => void;
}) {
  const addrs = useMemo(
    () => parseAddressList(phase.allowlistAddresses),
    [phase.allowlistAddresses],
  );
  const root = useMemo(() => computeMerkleRoot(addrs), [addrs]);
  return (
    <Field
      label="Allowlist addresses"
      hint="One address per line (or comma-separated). The Merkle root is computed here and baked into the phase; the list is registered for proof-serving after deploy."
    >
      <textarea
        className="field field-mono"
        rows={4}
        placeholder={"0xabc…\n0xdef…"}
        value={phase.allowlistAddresses}
        onChange={(e) => update(phase.id, { allowlistAddresses: e.target.value })}
      />
      <div className="mt-1 flex flex-wrap items-center gap-3 text-xs text-[var(--muted)]">
        <span className="tnum">{addrs.length} address(es)</span>
        {root ? (
          <span className="tnum">
            root <span className="text-[var(--ink)]">{root.slice(0, 10)}…{root.slice(-6)}</span>
          </span>
        ) : (
          <span>enter addresses to compute the root</span>
        )}
      </div>
    </Field>
  );
}

// ---- Step 4: Funding --------------------------------------------------------

function StepFunding({
  form,
  set,
  perTokenFunding,
}: {
  form: FormState;
  set: <K extends keyof FormState>(k: K, v: FormState[K]) => void;
  perTokenFunding: number;
}) {
  const pct = Number(form.tbaFundingPct) || 0;
  return (
    <div className="space-y-5">
      <Heading n={4} title="Vessel funding" />
      <p className="text-sm text-[var(--muted)]">
        This is what makes a Vessel a Vessel. A share of every mint payment is
        deposited straight into the new token&apos;s ERC-6551 account.
      </p>

      <Field
        label={`TBA funding — ${pct}% of mint price`}
        hint="Portion of each mint routed into the token's own wallet."
      >
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={pct}
          onChange={(e) => set("tbaFundingPct", e.target.value)}
          className="w-full accent-[var(--vermilion)]"
        />
      </Field>

      <div className="certificate p-4">
        <div className="label">Each minted NFT will be funded with</div>
        <div className="tnum mt-1 text-3xl font-bold accent">
          {perTokenFunding.toLocaleString("en-US", {
            maximumFractionDigits: 6,
          })}{" "}
          <span className="text-lg text-[var(--muted)]">
            {form.backingKind === "eth" ? "ETH" : "backing asset"}
          </span>
        </div>
        <p className="mt-1 text-xs text-[var(--muted)]">
          into its token-bound account at the moment of mint.
        </p>
      </div>

      <div>
        <div className="label mb-2">Backing asset</div>
        <div className="flex flex-wrap gap-2">
          <button
            className="btn"
            style={
              form.backingKind === "eth"
                ? { borderColor: "var(--vermilion)", color: "var(--vermilion)" }
                : undefined
            }
            onClick={() => {
              set("backingKind", "eth");
              set("backingAsset", zeroAddress);
            }}
          >
            Native ETH
          </button>
          <button
            className="btn"
            style={
              form.backingKind === "erc20"
                ? { borderColor: "var(--vermilion)", color: "var(--vermilion)" }
                : undefined
            }
            onClick={() => set("backingKind", "erc20")}
          >
            ERC-20 token
          </button>
        </div>
        {form.backingKind === "erc20" ? (
          <div className="mt-3">
            <Field label="Backing token address">
              <input
                className="field field-mono"
                placeholder="0x…"
                value={form.backingAsset === zeroAddress ? "" : form.backingAsset}
                onChange={(e) => set("backingAsset", e.target.value)}
              />
            </Field>
          </div>
        ) : null}
      </div>

      <div className="border-t border-[var(--rule)] pt-4">
        <label className="flex cursor-pointer items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 accent-[var(--vermilion)]"
            checked={form.enableCoinMarket}
            onChange={(e) => set("enableCoinMarket", e.target.checked)}
          />
          <span className="text-sm">
            <span className="font-semibold">Auto-create a SushiSwap coin market</span>
            <span className="block text-xs text-[var(--muted)]">
              Deploy a fungible coin vault (1 NFT = 1 coin) at launch so the collection
              can trade on SushiSwap. You can seed liquidity from the collection page
              afterward. Enabled in the same transaction.
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

// ---- Step 5: Review ---------------------------------------------------------

function StepReview({
  form,
  perTokenFunding,
  factoryReady,
  validity,
  isConnected,
  isPending,
  isConfirming,
  isSuccess,
  txHash,
  collectionAddress,
  allowlistStatus,
  writeError,
  onDeploy,
  onReset,
}: {
  form: FormState;
  perTokenFunding: number;
  factoryReady: boolean;
  validity: { ok: boolean; reason: string };
  isConnected: boolean;
  isPending: boolean;
  isConfirming: boolean;
  isSuccess: boolean;
  txHash?: `0x${string}`;
  collectionAddress?: Address;
  allowlistStatus: string | null;
  writeError: string | null;
  onDeploy: () => void;
  onReset: () => void;
}) {
  return (
    <div className="space-y-4">
      <Heading n={5} title="Review & deploy" />

      <table className="ledger text-sm">
        <tbody>
          <Row k="Name" v={form.name || "—"} />
          <Row k="Symbol" v={form.symbol || "—"} mono />
          <Row k="Max supply" v={form.maxSupply || "0"} mono />
          <Row k="Mint price" v={`${form.mintPrice || "0"} ETH`} mono />
          <Row k="Royalty" v={`${form.royaltyPct || "0"}%`} mono />
          <Row k="Phases" v={String(form.phases.length)} mono />
          <Row k="TBA funding" v={`${form.tbaFundingPct || "0"}%`} mono />
          <Row
            k="Per-token funding"
            v={`${perTokenFunding.toLocaleString("en-US", { maximumFractionDigits: 6 })} ${form.backingKind === "eth" ? "ETH" : "asset"}`}
            mono
            accent
          />
          <Row
            k="Backing asset"
            v={form.backingKind === "eth" ? "Native ETH" : form.backingAsset}
            mono
          />
          <Row k="Coin market" v={form.enableCoinMarket ? "SushiSwap · auto-enabled" : "Off"} />
        </tbody>
      </table>

      {!factoryReady ? (
        <Notice tone="warn">
          No factory address is configured (<code>NEXT_PUBLIC_FACTORY</code> is
          the zero address). Deployment is disabled — set it to your deployed
          CollectionFactory to enable on-chain deploys.
        </Notice>
      ) : null}

      {writeError ? <Notice tone="error">{writeError}</Notice> : null}

      {isSuccess ? (
        <Notice tone="ok">
          <div>
            <p className="font-semibold">Collection deployed.</p>
            {collectionAddress ? (
              <Link
                className="tnum text-[var(--vermilion)] underline"
                href={`/collection/${collectionAddress}`}
              >
                Open {collectionAddress}
              </Link>
            ) : (
              <p className="tnum text-xs">Tx {txHash}</p>
            )}
            {allowlistStatus ? (
              <p className="mt-1 text-xs text-[var(--muted)]">{allowlistStatus}</p>
            ) : null}
          </div>
        </Notice>
      ) : null}

      <div className="flex items-center gap-3">
        {!isConnected ? (
          <ConnectButton />
        ) : isSuccess ? (
          <button className="btn" onClick={onReset}>
            Deploy another
          </button>
        ) : (
          <button
            className="btn btn-primary"
            disabled={!validity.ok || !factoryReady || isPending || isConfirming}
            onClick={onDeploy}
          >
            {isPending
              ? "Confirm in wallet…"
              : isConfirming
                ? "Deploying…"
                : "Deploy collection"}
          </button>
        )}
        {!validity.ok ? (
          <span className="label">{validity.reason}</span>
        ) : null}
      </div>
    </div>
  );
}

// ---- Preview panel ----------------------------------------------------------

function PreviewPanel({
  form,
  perTokenFunding,
  backingAssetAddr,
}: {
  form: FormState;
  perTokenFunding: number;
  backingAssetAddr: Address;
}) {
  return (
    <aside className="lg:sticky lg:top-24 lg:self-start">
      <div className="certificate overflow-hidden">
        <div className="relative">
          {form.artPreview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={form.artPreview}
              alt="Artwork preview"
              className="h-40 w-full object-cover"
            />
          ) : (
            <ArtMark
              seed={form.symbol || form.name || "vessel"}
              label={form.symbol || "VSSL"}
              className="h-40 w-full"
            />
          )}
          <span className="chip chip-accent absolute right-2 top-2 bg-[var(--paper)]">
            {backingAssetAddr === zeroAddress ? "ETH" : "ERC-20"}
          </span>
        </div>
        <div className="p-4">
          <div className="label">Live preview</div>
          <h3 className="font-serif text-xl font-bold">
            {form.name || "Untitled Collection"}
          </h3>
          <p className="tnum text-sm text-[var(--muted)]">
            {form.symbol || "—"} · {form.maxSupply || "0"} supply
          </p>

          <dl className="mt-4 space-y-2 border-t border-[var(--rule)] pt-3 text-sm">
            <PrevRow k="Mint price" v={`${form.mintPrice || "0"} Ξ`} />
            <PrevRow k="Funds each token" v={`${form.tbaFundingPct || "0"}%`} />
            <PrevRow
              k="Per-token wallet"
              v={`${perTokenFunding.toLocaleString("en-US", { maximumFractionDigits: 5 })} Ξ`}
              accent
            />
          </dl>
        </div>
      </div>
      <p className="mt-3 text-xs text-[var(--muted)]">
        Every buyer receives a token that already holds{" "}
        <span className="tnum accent">
          {perTokenFunding.toLocaleString("en-US", { maximumFractionDigits: 5 })}{" "}
          ETH
        </span>{" "}
        in its own wallet.
      </p>
    </aside>
  );
}

// ---- Small primitives -------------------------------------------------------

function Heading({ n, title }: { n: number; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="tnum text-sm text-[var(--muted)]">0{n}</span>
      <h3 className="section-title text-xl">{title}</h3>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="label mb-1 flex items-center gap-1">
        {label}
        {required ? <span className="accent">*</span> : null}
      </div>
      {children}
      {hint ? (
        <p className="mt-1 text-xs text-[var(--muted)]">{hint}</p>
      ) : null}
    </label>
  );
}

function Row({
  k,
  v,
  mono,
  accent,
}: {
  k: string;
  v: string;
  mono?: boolean;
  accent?: boolean;
}) {
  return (
    <tr>
      <td className="label" style={{ width: "40%" }}>
        {k}
      </td>
      <td
        className={mono ? "tnum" : ""}
        style={{ color: accent ? "var(--vermilion)" : "var(--ink)" }}
      >
        {v}
      </td>
    </tr>
  );
}

function PrevRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <dt className="label">{k}</dt>
      <dd
        className="tnum text-sm font-semibold"
        style={{ color: accent ? "var(--vermilion)" : "var(--ink)" }}
      >
        {v}
      </dd>
    </div>
  );
}

function Notice({
  tone,
  children,
}: {
  tone: "ok" | "warn" | "error";
  children: React.ReactNode;
}) {
  const border =
    tone === "ok"
      ? "var(--teal)"
      : tone === "error"
        ? "var(--vermilion)"
        : "#b8860b";
  return (
    <div
      className="panel p-3 text-sm"
      style={{ borderLeft: `3px solid ${border}` }}
    >
      {children}
    </div>
  );
}
