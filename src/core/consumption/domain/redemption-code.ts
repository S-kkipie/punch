/**
 * Código corto de un canje, derivado de su id — no hay dato nuevo que guardar.
 * Sirve para que barista y cliente estén seguros de que hablan del mismo canje
 * cuando hay varias mesas pidiendo a la vez: el cliente lo ve en su historial y
 * el barista en su bandeja.
 */
export function redemptionCode(requestId: string): string {
    const clean = requestId.replace(/[^0-9a-z]/gi, "").toUpperCase();
    if (clean.length < 6) return clean;
    return `${clean.slice(0, 3)}-${clean.slice(3, 6)}`;
}
