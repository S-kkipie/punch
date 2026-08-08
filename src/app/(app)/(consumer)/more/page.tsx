import Link from "next/link";
import { SignOutButton } from "@/frontend/components/auth/sign-out-button";

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

export default function MorePage() {
    return (
        <div className="space-y-8">
            <div className="space-y-2">
                <span className="consumer-eyebrow">La red, a tu manera</span>
                <h1 className="consumer-title text-4xl font-bold tracking-tight">
                    Más para tu recorrido
                </h1>
                <p className="max-w-xl text-[var(--color-ink-2)]">
                    Encuentra tus campañas, rutas y opciones de cuenta en un
                    solo lugar.
                </p>
            </div>
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
            <section className="consumer-panel flex items-center justify-between gap-4 p-4">
                <div className="grid gap-1">
                    <span className="consumer-eyebrow">Tu cuenta</span>
                    <span className="font-semibold">¿Terminaste por hoy?</span>
                </div>
                <SignOutButton />
            </section>
        </div>
    );
}
