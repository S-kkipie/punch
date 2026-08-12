"use client";

import { explorerTxUrl } from "@/config/explorer";

function shorten(txHash: string): string {
    return `${txHash.slice(0, 8)}…${txHash.slice(-6)}`;
}

const chainLabels: Record<string, string> = {
    arbitrumSepolia: "Arbitrum Sepolia",
    local: "Cadena local",
};

/**
 * Renders a transaction hash, linking to the block explorer when the active
 * chain has one. Local Anvil runs fall back to plain text.
 *
 * The chain name travels with the hash on purpose: a bare hash reads as an
 * opaque string, while "Arbitrum Sepolia · 0x8f2a…" tells the reader what they
 * are about to verify and where.
 */
export function TxHashLink({
    txHash,
    chainLabel,
}: {
    txHash: string;
    chainLabel?: string;
}) {
    const href = explorerTxUrl(txHash);
    const label =
        chainLabel ??
        chainLabels[process.env.NEXT_PUBLIC_CHAIN_ENV ?? "local"] ??
        "Cadena";

    if (!href)
        return (
            <span className="tx-link tx-link--plain">{shorten(txHash)}</span>
        );

    return (
        <a
            className="tx-link"
            href={href}
            target="_blank"
            rel="noopener noreferrer"
        >
            <span className="tx-link__chain">{label}</span>
            {shorten(txHash)}
            <span aria-hidden="true">↗</span>
        </a>
    );
}
