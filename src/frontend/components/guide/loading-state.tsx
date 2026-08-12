/**
 * Skeleton con la forma del contenido que va a llegar. Un spinner centrado en
 * un contenedor vacío hace que la pantalla parezca rota mientras carga.
 */
export function LoadingState({
    label,
    lines = 3,
}: {
    label: string;
    lines?: number;
}) {
    return (
        <div className="guide-loading">
            <span className="sr-only" role="status">
                {label}
            </span>
            {Array.from({ length: lines }, (_, index) => (
                <span
                    key={`guide-skeleton-${index}`}
                    className="guide-skeleton"
                    aria-hidden="true"
                />
            ))}
        </div>
    );
}
