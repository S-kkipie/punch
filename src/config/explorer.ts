const explorerBase: Record<string, string | undefined> = {
    // Anvil has no explorer, so local runs render the hash as plain text.
    local: undefined,
    arbitrumSepolia: "https://sepolia.arbiscan.io",
};

/**
 * Block explorer link for a transaction, or null when the active chain has no
 * explorer. Reads NEXT_PUBLIC_CHAIN_ENV straight from process.env rather than
 * through @/config/env: that module validates server-only variables at import
 * time and throws when pulled into a client bundle.
 */
export function explorerTxUrl(txHash: string): string | null {
    const base = explorerBase[process.env.NEXT_PUBLIC_CHAIN_ENV ?? "local"];
    return base ? `${base}/tx/${txHash}` : null;
}

/**
 * Whether the active chain has a public block explorer. Copy that promises the
 * user they can verify an operation must not make that promise when there is
 * nowhere to send them.
 */
export function hasPublicExplorer(): boolean {
    return explorerBase[process.env.NEXT_PUBLIC_CHAIN_ENV ?? "local"] != null;
}
