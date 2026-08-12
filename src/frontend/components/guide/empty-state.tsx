import Link from "next/link";

/**
 * Un vacío se explica por su causa y ofrece salida. «No hay datos» deja al
 * usuario sin siguiente paso; «las rutas nacen cuando hay 3 cafeterías cerca»
 * le enseña la mecánica del producto.
 */
export function EmptyState({
    mark,
    title,
    cause,
    action,
}: {
    mark?: string;
    title: string;
    cause: string;
    action?: { label: string; href: string };
}) {
    return (
        <div className="empty-state">
            {mark ? (
                <span className="empty-state__mark" aria-hidden="true">
                    {mark}
                </span>
            ) : null}
            <h3 className="empty-state__title">{title}</h3>
            <p className="empty-state__cause">{cause}</p>
            {action ? (
                <Link className="guide-btn guide-btn--ghost" href={action.href}>
                    {action.label}
                </Link>
            ) : null}
        </div>
    );
}
