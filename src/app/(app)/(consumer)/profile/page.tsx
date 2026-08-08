import Link from "next/link";

export default function ProfilePage() {
    return (
        <main className="mx-auto grid w-full max-w-xl gap-5">
            <section className="consumer-panel grid gap-3 p-6">
                <span className="consumer-eyebrow">Tu cuenta</span>
                <h1 className="consumer-title text-4xl font-bold">Perfil</h1>
                <p className="text-[var(--color-ink-2)]">
                    Tu sesión está protegida en este dispositivo. Para cambiar
                    de cuenta, usa Cerrar sesión desde Más.
                </p>
            </section>
            <Link className="font-semibold underline" href="/more">
                Volver a Más
            </Link>
        </main>
    );
}
