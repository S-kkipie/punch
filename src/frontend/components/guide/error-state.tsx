export function ErrorState({
    title,
    detail,
    onRetry,
}: {
    title: string;
    detail: string;
    onRetry?: () => void;
}) {
    return (
        <div className="guide-error" role="alert">
            <b className="guide-error__title">{title}</b>
            <p className="guide-error__detail">{detail}</p>
            {onRetry ? (
                <button
                    className="guide-btn guide-btn--ghost"
                    type="button"
                    onClick={onRetry}
                >
                    Reintentar
                </button>
            ) : null}
        </div>
    );
}
