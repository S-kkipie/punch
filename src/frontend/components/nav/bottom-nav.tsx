"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS = [
    { href: "/home", label: "Inicio", icon: "⌂", central: false },
    { href: "/discover", label: "Descubre", icon: "✦", central: false },
    { href: "/scan", label: "Escanear", icon: "＋", central: true },
    { href: "/history", label: "Historial", icon: "↺", central: false },
    { href: "/more", label: "Más", icon: "•••", central: false },
] as const;

export function BottomNav() {
    const pathname = usePathname();
    return (
        <nav aria-label="Navegación principal" className="consumer-nav">
            <div className="consumer-nav__inner">
                {TABS.map((tab) => {
                    const active =
                        pathname === tab.href ||
                        pathname.startsWith(`${tab.href}/`);
                    return (
                        <Link
                            key={tab.href}
                            href={tab.href}
                            aria-current={active ? "page" : undefined}
                            className={`consumer-nav__link${tab.central ? " consumer-nav__link--central" : ""}${active ? " consumer-nav__link--active" : ""}`}
                        >
                            <span
                                aria-hidden="true"
                                className="consumer-nav__icon"
                            >
                                {tab.icon}
                            </span>
                            <span>{tab.label}</span>
                        </Link>
                    );
                })}
            </div>
        </nav>
    );
}
