export default function OfflinePage() {
    return (
        <main className="mx-auto grid min-h-svh max-w-xl content-center gap-4 px-6 py-12 text-center">
            <p className="consumer-eyebrow">PUNCH</p>
            <h1 className="consumer-title text-4xl font-bold">
                Estás sin conexión
            </h1>
            <p className="text-[var(--color-ink-2)]">
                Revisa los datos guardados en tu dispositivo. Para registrar una
                compra o solicitar un canje, vuelve a conectarte.
            </p>
            <a
                className="mx-auto min-h-11 rounded-md bg-[var(--color-ink)] px-5 py-3 font-semibold text-white"
                href="/home"
            >
                Volver a PUNCH
            </a>
        </main>
    );
}
