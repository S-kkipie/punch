import type {
    Account,
    Chain,
    PublicClient,
    Transport,
    WalletClient,
} from "viem";
import { abis } from "@/core/chain/abis";
import type { AddressMap } from "@/core/chain/addresses";
import { currentEpoch } from "./epoch";

export type EpochOpsDeps = {
    pub: Pick<PublicClient, "readContract" | "waitForTransactionReceipt">;
    wallet: Pick<WalletClient<Transport, Chain, Account>, "writeContract">;
    addresses: AddressMap;
    listChainCafeIds: () => Promise<number[]>;
};

type OriginClaim = {
    chainCafeId: number;
    referrals: number;
    amount: bigint;
};

async function waitForWrite(
    pub: EpochOpsDeps["pub"],
    hash: `0x${string}`,
): Promise<void> {
    const receipt = await pub.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") {
        throw new Error(`NetworkFund transaction reverted: ${hash}`);
    }
}

export async function fundCurrentEpoch(
    deps: EpochOpsDeps,
    epoch = currentEpoch(),
): Promise<{ epoch: number; amount: bigint }> {
    const amount = await deps.pub.readContract({
        address: deps.addresses.networkFund,
        abi: abis.networkFund,
        functionName: "freeBalance",
    });
    if (amount === 0n) return { epoch, amount };

    const hash = await deps.wallet.writeContract({
        address: deps.addresses.networkFund,
        abi: abis.networkFund,
        functionName: "fundEpoch",
        args: [BigInt(epoch), amount],
    });
    await waitForWrite(deps.pub, hash);

    return { epoch, amount };
}

export async function closeEpoch(
    deps: EpochOpsDeps,
    epoch = currentEpoch(),
): Promise<{ epoch: number; claims: OriginClaim[] }> {
    const epochId = BigInt(epoch);
    const epochState = await deps.pub.readContract({
        address: deps.addresses.networkFund,
        abi: abis.networkFund,
        functionName: "getEpoch",
        args: [epochId],
    });

    if (!epochState.finalized) {
        const hash = await deps.wallet.writeContract({
            address: deps.addresses.networkFund,
            abi: abis.networkFund,
            functionName: "finalizeOriginEpoch",
            args: [epochId],
        });
        await waitForWrite(deps.pub, hash);
    }

    const claims: OriginClaim[] = [];
    for (const chainCafeId of await deps.listChainCafeIds()) {
        const cafeId = BigInt(chainCafeId);
        const referrals = await deps.pub.readContract({
            address: deps.addresses.networkFund,
            abi: abis.networkFund,
            functionName: "referrals",
            args: [epochId, cafeId],
        });
        if (referrals === 0n) continue;

        const alreadyClaimed = await deps.pub.readContract({
            address: deps.addresses.networkFund,
            abi: abis.networkFund,
            functionName: "originClaimed",
            args: [epochId, cafeId],
        });
        if (alreadyClaimed) continue;

        const amount = await deps.pub.readContract({
            address: deps.addresses.networkFund,
            abi: abis.networkFund,
            functionName: "pendingOriginCredit",
            args: [epochId, cafeId],
        });

        try {
            const hash = await deps.wallet.writeContract({
                address: deps.addresses.networkFund,
                abi: abis.networkFund,
                functionName: "claimOriginCredit",
                args: [epochId, cafeId],
            });
            await waitForWrite(deps.pub, hash);
            claims.push({
                chainCafeId,
                referrals: Number(referrals),
                amount,
            });
        } catch {
            // Claims are permissionless and idempotent at the operation level:
            // one reverted cafe must not prevent later cafes from being paid.
        }
    }

    return { epoch, claims };
}
