export function currentEpoch(date: Date = new Date()): number {
    return date.getUTCFullYear() * 100 + (date.getUTCMonth() + 1);
}
