"use client";

import { DemoOnly } from "@/frontend/components/guide/demo-only";
import { ClientConfig } from "@/config/client-config";
import { useDemoSignIn } from "./use-demo-sign-in";

const DEMO_LOGINS = [
    {
        email: "demo-consumer@punch.pe",
        destination: "/home",
        label: "☕ Entrar como cliente",
        blurb: "Tienes 11 de 12 sellos y una ruta a medias. Empieza aquí si quieres ver el producto como lo ve el barrio.",
        buttonClass: "guide-btn w-full",
    },
    {
        email: "brujula@punch.pe",
        destination: "/cafe",
        label: "🏪 Entrar como cafetería",
        blurb: "Eres Café Brújula, en Miraflores. Verás tus ventas, tus canjes y tu parte del fondo común.",
        buttonClass: "guide-btn guide-btn--ghost w-full",
    },
] as const;

export function DemoLogin() {
    const { signInAs, pending, error } = useDemoSignIn();

    if (!ClientConfig.demoMode || !ClientConfig.demoPassword) {
        return null;
    }

    return (
        <section className="consumer-panel grid gap-4 p-5">
            <DemoOnly />
            <span className="consumer-eyebrow">Recorre la demo</span>
            {DEMO_LOGINS.map((demo) => (
                <div className="grid gap-2" key={demo.email}>
                    <button
                        type="button"
                        className={demo.buttonClass}
                        disabled={pending !== null}
                        onClick={() => {
                            void signInAs(demo.email, demo.destination);
                        }}
                    >
                        {pending === demo.email ? "Entrando…" : demo.label}
                    </button>
                    <p className="text-sm text-[var(--color-ink-2)]">{demo.blurb}</p>
                </div>
            ))}
            <p className="border-t border-[var(--color-rule)] pt-2 text-sm text-[var(--color-ink-2)]">
                Puedes cambiar de rol en cualquier momento desde la barra superior.
            </p>
            {error ? (
                <p className="text-center text-sm text-destructive">{error}</p>
            ) : null}
        </section>
    );
}
