"use client";

import Link from "next/link";

import { ClientConfig } from "@/config/client-config";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";
import { useDemoSignIn } from "@/frontend/components/auth/use-demo-sign-in";
import { DemoOnly } from "@/frontend/components/guide/demo-only";
import { PageIntro } from "@/frontend/components/guide/page-intro";

const links = [
    {
        href: "/campaigns",
        eyebrow: "Ahora",
        label: "Campañas",
        detail: "Descubre invitaciones de la red",
    },
    {
        href: "/crawls",
        eyebrow: "En ruta",
        label: "Rutas de café",
        detail: "Sigue tus recorridos por la ciudad",
    },
    {
        href: "/profile",
        eyebrow: "Tu cuenta",
        label: "Perfil",
        detail: "Preferencias y datos de acceso",
    },
    {
        href: "/install",
        eyebrow: "En tu bolsillo",
        label: "Instalar PUNCH",
        detail: "Añade la app a tu pantalla de inicio",
    },
];

const glossary = [
    {
        question: "¿Qué es un sello?",
        answer: "Una compra, un sello. 12 sellos, un café.",
    },
    {
        question: "¿Qué es el fondo común?",
        answer: "Parte de cada venta va a un bote que reparte la red.",
    },
    {
        question: "¿Por qué en blockchain?",
        answer: "Para que ninguna cafetería —ni PUNCH— pueda borrar tus sellos.",
    },
];

function DemoExitPanel() {
    const { signInAs, pending, error } = useDemoSignIn();

    if (!ClientConfig.demoMode) {
        return null;
    }

    return (
        <section className="consumer-panel grid gap-2 p-4">
            <span className="consumer-eyebrow">
                ¿Ya viste todo el lado cliente?
            </span>
            <p className="text-[var(--color-ink-2)] text-sm">
                Pasa a cafetería: Brújula Café te espera. Ahí ves ventas, canjes
                y tu parte del fondo común.
            </p>
            <button
                type="button"
                className="guide-btn self-start"
                onClick={() => signInAs("brujula@punch.pe", "/cafe")}
                disabled={Boolean(pending)}
            >
                {pending ? "Cambiando…" : "Pasa a cafetería"}
            </button>
            {error ? (
                <p className="text-[var(--color-accent)] text-sm">{error}</p>
            ) : null}
            <DemoOnly />
        </section>
    );
}

export default function MorePage() {
    return (
        <div className="grid gap-8">
            <PageIntro eyebrow="La red, a tu manera" title="Más" />

            <section className="consumer-panel grid gap-2 p-4">
                <span className="consumer-eyebrow">Cómo funciona</span>
                <div className="grid gap-3">
                    {glossary.map((entry) => (
                        <article key={entry.question} className="grid gap-1">
                            <p className="font-semibold">{entry.question}</p>
                            <p className="text-[var(--color-ink-2)] text-sm">
                                {entry.answer}
                            </p>
                        </article>
                    ))}
                </div>
            </section>

            <ul className="consumer-panel consumer-link-list p-4">
                {links.map((link) => (
                    <li key={link.href}>
                        <Link href={link.href}>
                            <span className="grid gap-1">
                                <span className="consumer-eyebrow">
                                    {link.eyebrow}
                                </span>
                                <span>{link.label}</span>
                                <span className="font-normal text-sm text-[var(--color-ink-2)]">
                                    {link.detail}
                                </span>
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>

            <section
                className="consumer-panel grid gap-2 p-5"
                aria-labelledby="profile-title"
            >
                <span className="consumer-eyebrow">Tu cuenta</span>
                <h2
                    id="profile-title"
                    className="consumer-title text-2xl font-bold"
                >
                    Perfil
                </h2>
                <p className="text-[var(--color-ink-2)]">
                    Gestiona tu sesión desde este dispositivo. No mostramos
                    saldo ni datos técnicos aquí.
                </p>
            </section>

            <details className="consumer-panel p-5">
                <summary className="min-h-11 cursor-pointer py-2 font-semibold">
                    Instalar PUNCH
                </summary>
                <p className="mt-3 text-[var(--color-ink-2)]">
                    En el menú de tu navegador elige “Añadir a pantalla de
                    inicio” para abrir PUNCH como una app.
                </p>
            </details>

            <section className="consumer-panel flex items-center justify-between gap-4 p-4">
                <div className="grid gap-1">
                    <span className="consumer-eyebrow">Tu cuenta</span>
                    <span className="font-semibold">¿Terminaste por hoy?</span>
                </div>
                <SignOutButton />
            </section>

            <DemoExitPanel />
        </div>
    );
}
