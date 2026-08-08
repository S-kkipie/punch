export const PUNCH_REDEMPTION_COST = 12;

export function progressFraction(balance: number): {
    numerator: number;
    denominator: 12;
} {
    if (!Number.isInteger(balance) || balance < 0) {
        throw new Error(`Invalid PUNCH balance: ${balance}`);
    }
    return {
        numerator: Math.min(balance, PUNCH_REDEMPTION_COST),
        denominator: PUNCH_REDEMPTION_COST,
    };
}

function assertValidBalance(balance: number): void {
    if (
        !Number.isFinite(balance) ||
        !Number.isInteger(balance) ||
        balance < 0
    ) {
        throw new Error(`Invalid PUNCH balance: ${balance}`);
    }
}

export function canRedeem(balance: number): boolean {
    assertValidBalance(balance);
    return balance >= PUNCH_REDEMPTION_COST;
}

export function balanceAfterRedemption(balance: number): number {
    if (!canRedeem(balance)) {
        throw new Error("Insufficient PUNCH balance for redemption");
    }
    return balance - PUNCH_REDEMPTION_COST;
}
