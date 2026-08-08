import Link from "next/link";

export default function InstallPage() {
    return (
        <main className="mx-auto grid w-full max-w-xl gap-5">
            <section className="consumer-panel grid gap-3 p-6">
                <span className="consumer-eyebrow">En tu bolsillo</span>
                <h1 className="consumer-title text-4xl font-bold">
                    Instalar PUNCH
                </h1>
                <p className="text-[var(--color-ink-2)]">
                    Abre el menú de tu navegador y elige “Añadir a pantalla de
                    inicio” para usar PUNCH como una app.
                </p>
            </section>
            <Link className="font-semibold underline" href="/more">
                Volver a Más
            </Link>
        </main>
    );
}
