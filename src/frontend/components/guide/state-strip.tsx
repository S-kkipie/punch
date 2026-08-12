import type { ReactNode } from "react";

export type StateStripTone = "chain" | "offline" | "saved";

/**
 * Tira de aviso de una línea. Reemplaza los <p> sueltos con estilo inline que
 * hoy anuncian estado de cadena y modo offline.
 */
export function StateStrip({
    tone,
    children,
}: {
    tone: StateStripTone;
    children: ReactNode;
}) {
    return (
        <p className={`state-strip state-strip--${tone}`} role="status">
            {children}
        </p>
    );
}
