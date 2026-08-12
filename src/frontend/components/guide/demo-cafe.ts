/**
 * La demo solo tiene una sesión de cafetería: brujula@punch.pe, dueña del café
 * sembrado con slug `brujula-cafe` (scripts/seed.ts). Un canje pedido en
 * cualquier otro café queda esperando para siempre, porque nadie puede entrar
 * como esa cafetería para entregarlo. Por eso la guía empuja siempre a Brújula.
 */
export const DEMO_CAFE_SLUG = "brujula-cafe";

export function isDemoCafe(cafe: { slug?: string | null }): boolean {
    return cafe.slug === DEMO_CAFE_SLUG;
}

/** Brújula primero; el resto conserva su orden. */
export function demoCafeFirst<T extends { slug?: string | null }>(
    cafes: readonly T[],
): T[] {
    return [...cafes].sort(
        (a, b) => Number(isDemoCafe(b)) - Number(isDemoCafe(a)),
    );
}
