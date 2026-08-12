/**
 * Ventana por defecto de una campaña nueva. El contrato revierte con
 * ExpiryInPast si la fecha de fin ya pasó, y ese fallo recién aparece al
 * publicar — mucho después de crear y financiar. Arrancar con una ventana
 * válida evita el error en vez de explicarlo.
 */
export const DEFAULT_WINDOW_DAYS = 30;

/** `datetime-local` espera hora local sin zona: `YYYY-MM-DDTHH:mm`. */
export function toDateTimeLocal(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate(),
    )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function defaultCampaignWindow(now: Date): {
    start: string;
    end: string;
} {
    const end = new Date(now);
    end.setDate(end.getDate() + DEFAULT_WINDOW_DAYS);
    return { start: toDateTimeLocal(now), end: toDateTimeLocal(end) };
}
