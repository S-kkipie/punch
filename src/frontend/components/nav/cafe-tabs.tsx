"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * Pestañas de la cafetería. Todas las rutas ya existen: esto solo deja de
 * esconderlas detrás de botones dentro del cuerpo del panel.
 */
export function CafeTabs({ cafeId }: { cafeId: string }) {
    const pathname = usePathname();
    const base = `/cafe/${cafeId}`;
    const tabs = [
        { href: base, label: "Resumen" },
        { href: `${base}/terminal`, label: "Terminal" },
        { href: `${base}/redemptions`, label: "Canjes" },
        { href: `${base}/campaigns`, label: "Campañas" },
        { href: `${base}/plan`, label: "Plan" },
    ];
    return (
        <nav className="ws-tabs" aria-label="Secciones de la cafetería">
            {tabs.map((tab) => (
                <Link
                    key={tab.href}
                    href={tab.href}
                    className="ws-tabs__link"
                    aria-current={pathname === tab.href ? "page" : undefined}
                >
                    {tab.label}
                </Link>
            ))}
        </nav>
    );
}
