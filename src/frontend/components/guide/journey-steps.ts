export type JourneyInput = {
    balance: number | null;
    hasPendingPurchase: boolean;
    hasPendingRedemption: boolean;
    hasConfirmedRedemption: boolean;
};

export const journeySteps = [
    {
        title: "La cafetería genera un código de compra",
        role: "cafeteria" as const,
    },
    {
        title: "Escanea y confirma tu compra",
        role: "cliente" as const,
    },
    {
        title: "Repite hasta juntar 12 sellos",
        role: "cafeteria" as const,
    },
    {
        title: "Pide tu canje",
        role: "cliente" as const,
    },
    {
        title: "La cafetería entrega el canje",
        role: "cafeteria" as const,
    },
    {
        title: "Ciclo completo: el fondo común se actualiza",
        role: "cafeteria" as const,
    },
] as const;

export function deriveJourneyStep(input: JourneyInput): number {
    const balance = input.balance ?? 0;

    if (input.hasPendingRedemption) return 4;
    if (input.hasConfirmedRedemption) return 5;

    if (input.hasPendingPurchase) return 1;

    if (balance < 12) return 0;

    return 3;
}

export function blockedLabel(base: string, reason: string): string {
    return `${base} · ${reason}`;
}
