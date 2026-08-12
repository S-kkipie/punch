"use client";

import { useSyncExternalStore } from "react";

/**
 * Estado global de la demo, vivo en el navegador.
 *
 * El recorrido guiado se deriva sobre todo de la cadena y de la base de datos,
 * pero hay acciones del jurado que todavía no tienen reflejo consultable desde
 * el rol activo: cuando la cafetería genera un código de compra, ese código
 * pertenece al cliente y la sesión de cafetería no puede verlo. Aquí guardamos
 * esas acciones para que la guía avance en el momento en que ocurren.
 *
 * Solo se guarda intención de la demo (un enlace de compra ya emitido). Nunca
 * datos de cadena: esos siempre se leen del indexador.
 */

export const DEMO_STATE_KEY = "punch.demo.state";
const DEMO_STATE_EVENT = "punch:demo-state";

export type DemoState = {
    /** Enlace absoluto de la compra que la cafetería acaba de generar. */
    pendingProofUrl: string | null;
    /** Canje pedido por el cliente y todavía sin entregar. */
    pendingRedemptionId: string | null;
    /** La cafetería ya entregó el canje: el ciclo se cerró. */
    redemptionDelivered: boolean;
};

export const emptyDemoState: DemoState = {
    pendingProofUrl: null,
    pendingRedemptionId: null,
    redemptionDelivered: false,
};

const text = (value: unknown): string | null =>
    typeof value === "string" && value ? value : null;

export function parseDemoState(raw: string | null): DemoState {
    if (!raw) return emptyDemoState;

    try {
        const parsed = JSON.parse(raw) as {
            pendingProofUrl?: unknown;
            pendingRedemptionId?: unknown;
            redemptionDelivered?: unknown;
        };
        return {
            pendingProofUrl: text(parsed?.pendingProofUrl),
            pendingRedemptionId: text(parsed?.pendingRedemptionId),
            redemptionDelivered: parsed?.redemptionDelivered === true,
        };
    } catch {
        return emptyDemoState;
    }
}

let snapshot: DemoState = emptyDemoState;

function readStorage(): DemoState {
    if (typeof window === "undefined") return emptyDemoState;
    try {
        return parseDemoState(window.localStorage.getItem(DEMO_STATE_KEY));
    } catch {
        return emptyDemoState;
    }
}

function sameState(left: DemoState, right: DemoState): boolean {
    return (
        left.pendingProofUrl === right.pendingProofUrl &&
        left.pendingRedemptionId === right.pendingRedemptionId &&
        left.redemptionDelivered === right.redemptionDelivered
    );
}

function refreshSnapshot(): void {
    const next = readStorage();
    if (!sameState(next, snapshot)) {
        snapshot = next;
    }
}

export function readDemoState(): DemoState {
    refreshSnapshot();
    return snapshot;
}

function write(next: DemoState): void {
    if (typeof window === "undefined") return;
    try {
        window.localStorage.setItem(DEMO_STATE_KEY, JSON.stringify(next));
    } catch {
        // Modo privado o storage lleno: la guía sigue funcionando sin memoria.
    }
    snapshot = next;
    window.dispatchEvent(new Event(DEMO_STATE_EVENT));
}

export function setPendingProofUrl(url: string | null): void {
    const current = readDemoState();
    write({
        ...current,
        pendingProofUrl: url,
        // Un código nuevo abre otro ciclo: el canje anterior deja de ser el
        // paso actual del recorrido.
        redemptionDelivered: url ? false : current.redemptionDelivered,
    });
}

export function clearPendingProofUrl(): void {
    setPendingProofUrl(null);
}

/**
 * El canje lo pide el cliente y lo entrega la cafetería: son dos sesiones
 * distintas, así que ninguna puede ver el estado de la otra consultando lo
 * suyo. Esto es lo que mantiene el recorrido en el paso correcto al cambiar
 * de rol.
 */
export function setPendingRedemptionId(id: string | null): void {
    write({
        ...readDemoState(),
        pendingRedemptionId: id,
        redemptionDelivered: false,
    });
}

export function markRedemptionDelivered(): void {
    write({
        ...readDemoState(),
        pendingRedemptionId: null,
        redemptionDelivered: true,
    });
}

function subscribe(onChange: () => void): () => void {
    if (typeof window === "undefined") return () => {};

    const handler = () => {
        refreshSnapshot();
        onChange();
    };

    window.addEventListener(DEMO_STATE_EVENT, handler);
    window.addEventListener("storage", handler);
    return () => {
        window.removeEventListener(DEMO_STATE_EVENT, handler);
        window.removeEventListener("storage", handler);
    };
}

export function useDemoState(): DemoState {
    return useSyncExternalStore(subscribe, readDemoState, () => emptyDemoState);
}
