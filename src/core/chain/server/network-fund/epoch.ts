import { formatUnits } from "viem";

const INVALID_EPOCH_MESSAGE =
    "El argumento --epoch debe usar YYYYMM con un mes del 01 al 12";

export function currentEpoch(date: Date = new Date()): number {
    return date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);
}

export function requestedEpoch(
    args: string[],
    fallbackEpoch: number = currentEpoch(),
): number {
    const flagIndex = args.indexOf("--epoch");
    const value =
        flagIndex >= 0
            ? args[flagIndex + 1]
            : args.find((arg) => arg.startsWith("--epoch="))?.slice(8);

    if (flagIndex < 0 && value === undefined) return fallbackEpoch;
    if (
        value === undefined ||
        !/^\d{6}$/.test(value) ||
        Number(value.slice(4)) < 1 ||
        Number(value.slice(4)) > 12
    ) {
        throw new Error(INVALID_EPOCH_MESSAGE);
    }
    return Number(value);
}

export function formatMpen(amount: bigint): string {
    return `${formatUnits(amount, 6)} mPEN`;
}
