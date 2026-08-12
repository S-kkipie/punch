/**
 * Traducción de los códigos de revert que el relayer guarda en el job a una
 * frase que dice qué pasó y qué hacer. Sin esto la pantalla solo puede mostrar
 * `expiry_in_past`, que no le explica nada a la dueña de una cafetería.
 *
 * Los códigos vienen de `parse-revert.ts`; este módulo es de cliente a
 * propósito, así que no importa nada del servidor.
 */
const revertCopy: Record<string, string> = {
    expiry_in_past:
        "La ventana de la campaña termina en una fecha que ya pasó. Crea la campaña de nuevo con una fecha de fin futura.",
    insufficient_budget:
        "El presupuesto apartado no cubre todos los vouchers prometidos. Financia lo que falta y vuelve a publicar.",
    insufficient_free_balance:
        "El contrato no tiene saldo libre suficiente para asignar ese presupuesto.",
    not_draft:
        "Esta campaña ya no es un borrador, así que esa operación ya no aplica.",
    not_published: "La campaña todavía no está publicada.",
    campaign_not_found: "La campaña no existe en la cadena.",
    campaign_expired: "La campaña ya venció.",
    max_vouchers_reached: "Ya se entregaron todos los vouchers de la campaña.",
    cafe_not_operational:
        "La cafetería no está operativa en la red, así que la cadena rechaza la operación.",
    zero_amount: "El monto tiene que ser mayor a cero.",
    paused: "Las operaciones on-chain están pausadas por operaciones.",
    not_owner: "Esta cuenta no tiene permiso para esa operación on-chain.",
    not_campaign_operator:
        "Solo el operador de campañas puede ejecutar esa operación.",
    voucher_already_redeemed: "Ese voucher ya fue canjeado.",
    voucher_already_unlocked: "Ese voucher ya estaba desbloqueado.",
    voucher_not_unlocked: "Ese voucher todavía no está desbloqueado.",
    insufficient_punch: "No hay sellos suficientes para el canje.",
    invalid_signature: "La firma de la operación no es válida.",
    expired: "La prueba de compra venció antes de llegar a la cadena.",
    // El relayer también guarda fallos que no vienen de un revert del contrato.
    "unknown chain or network error":
        "La cadena rechazó la operación o la red no respondió. No se cobró ni se descontó nada; puedes volver a intentar.",
    invalid_payload:
        "La operación se guardó incompleta y no se pudo enviar. Vuelve a lanzarla.",
    unknown:
        "La cadena rechazó la operación. Nada se cobró ni se descontó; puedes volver a intentar.",
};

/**
 * Frase para un error de job. Un código desconocido devuelve el texto crudo:
 * es feo, pero mentir sobre lo que pasó es peor que mostrar algo técnico.
 */
export function revertMessage(error: string | null | undefined): string | null {
    if (!error) return null;
    return revertCopy[error] ?? error;
}
