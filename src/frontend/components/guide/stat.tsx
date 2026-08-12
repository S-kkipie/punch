/**
 * Una cifra que importa se ve como cifra. El workspace escribe hoy sus totales
 * como párrafos, que se leen como prosa y no como dato.
 */
export function Stat({
    label,
    value,
    hint,
    lead = false,
}: {
    label: string;
    value: string;
    hint?: string;
    lead?: boolean;
}) {
    return (
        <div className={`guide-stat${lead ? " guide-stat--lead" : ""}`}>
            <span className="guide-stat__label">{label}</span>
            <span className="guide-stat__value">{value}</span>
            {hint ? <span className="guide-stat__hint">{hint}</span> : null}
        </div>
    );
}
