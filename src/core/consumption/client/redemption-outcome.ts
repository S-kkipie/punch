/**
 * Lee el resultado de pedir un canje sin depender de cómo lo envuelva el
 * cliente HTTP: unas veces el fallo llega como error de la mutación y otras
 * como cuerpo de la respuesta. La pantalla necesita distinguir tres cosas
 * distintas — pedido, ya había uno pendiente, y falló — porque cada una tiene
 * un siguiente paso diferente para quien está usando la app.
 */

export type RedemptionOutcome =
    | { kind: "requested"; id: string; status: string }
    | { kind: "conflict" }
    | { kind: "error"; message: string };

const GENERIC_ERROR = "No se pudo pedir el canje. Vuelve a intentarlo.";

type Bag = Record<string, unknown>;

function asBag(value: unknown): Bag | null {
    return value && typeof value === "object" ? (value as Bag) : null;
}

/** Desenvuelve `{ response }`, `{ value }` y `{ data }` hasta el cuerpo real. */
function bodyOf(value: unknown): Bag | null {
    const bag = asBag(value);
    if (!bag) return null;

    for (const key of ["response", "value", "data"]) {
        const inner = asBag(bag[key]);
        if (inner) return bodyOf(inner) ?? inner;
    }
    return bag;
}

function isConflict(body: Bag): boolean {
    return body.code === "CONFLICT" || body.status === 409;
}

export function readRedemptionOutcome(
    data: unknown,
    error: unknown,
): RedemptionOutcome | null {
    const fromData = bodyOf(data);
    if (fromData && typeof fromData.id === "string") {
        return {
            kind: "requested",
            id: fromData.id,
            status:
                typeof fromData.status === "string"
                    ? fromData.status
                    : "pending",
        };
    }

    for (const candidate of [fromData, bodyOf(error)]) {
        if (!candidate) continue;
        if (isConflict(candidate)) return { kind: "conflict" };
        if (candidate.code !== undefined || candidate.status !== undefined) {
            return {
                kind: "error",
                message:
                    typeof candidate.cause === "string"
                        ? candidate.cause
                        : GENERIC_ERROR,
            };
        }
    }

    if (error instanceof Error) {
        return { kind: "error", message: error.message || GENERIC_ERROR };
    }

    return null;
}
