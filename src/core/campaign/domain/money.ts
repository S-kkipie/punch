/**
 * mPEN tiene 6 decimales: S/5.00 son 5_000_000 unidades base. La API de
 * campañas habla en unidades base y la cafetería piensa en soles, así que la
 * conversión vive aquí y no repartida por las pantallas.
 */
const MPEN_PER_SOL = 1_000_000n;

/**
 * Convierte lo que escribe la cafetería ("5", "5.50") a unidades base.
 * Devuelve null si no es un monto de soles válido — nunca redondea en silencio,
 * porque un céntimo perdido aquí es presupuesto que la campaña no cubre.
 */
export function parseSolesToMpen(input: string): bigint | null {
    const trimmed = input.trim();
    if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
    const [whole, decimals = ""] = trimmed.split(".");
    const centimos = decimals.padEnd(2, "0");
    const total =
        BigInt(whole) * MPEN_PER_SOL + BigInt(centimos) * (MPEN_PER_SOL / 100n);
    return total > 0n ? total : null;
}

/** Unidades base a texto en soles, para mostrar. */
export function formatMpenAsSoles(value: bigint | string): string {
    const amount = typeof value === "bigint" ? value : BigInt(value);
    const negative = amount < 0n;
    const absolute = negative ? -amount : amount;
    const whole = absolute / MPEN_PER_SOL;
    const centimos = (absolute % MPEN_PER_SOL) / (MPEN_PER_SOL / 100n);
    return `${negative ? "-" : ""}S/${whole}.${centimos.toString().padStart(2, "0")}`;
}
