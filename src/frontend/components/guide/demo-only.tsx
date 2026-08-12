export function DemoOnly() {
    return (
        <button
            type="button"
            className="demo-only"
            tabIndex={0}
            aria-label="Este mensaje no aparecerá en el producto final. Existe para guiar la demo."
        >
            <span className="demo-only__label">● solo demo</span>
            <span className="demo-only__message">
                Este mensaje no aparecerá en el producto final. Existe para
                guiar la demo.
            </span>
        </button>
    );
}
