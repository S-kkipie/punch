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
    if (input.hasPendingPurchase) return 1;

    // El saldo manda sobre un canje ya confirmado: si el cliente volvió a
    // acumular sellos, arrancó un ciclo nuevo y "ciclo completo" (5) quedó
    // atrás. Sin esto, el canje de una demo pasada dejaba la guía marcada
    // como terminada para siempre.
    if (balance >= 12) return 3;
    if (balance > 0) return 0;

    // Saldo en cero y un canje confirmado: el cliente acaba de cerrar el ciclo.
    if (input.hasConfirmedRedemption) return 5;

    return 0;
}

export function blockedLabel(base: string, reason: string): string {
    return `${base} · ${reason}`;
}
