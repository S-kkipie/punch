/* biome-ignore-all lint/a11y/useValidAnchor: landing links provide default section navigation */
"use client";

import { useEffect, useRef, useState } from "react";
import { LANDING_COPY, LANDING_LINKS } from "./landing-content";

const COMPACT_THRESHOLD = 48;

export function LandingNav() {
    const [isCompact, setIsCompact] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    const [isMenuOpen, setIsMenuOpen] = useState(false);
    const [isEnhanced, setIsEnhanced] = useState(false);
    const lastY = useRef(0);

    useEffect(() => {
        setIsEnhanced(true);
        const onScroll = () => {
            const y = window.scrollY;
            if (y <= COMPACT_THRESHOLD) setIsCompact(false);
            else if (y > lastY.current) setIsCompact(true);
            else if (y < lastY.current) setIsCompact(false);
            lastY.current = y;
        };
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") setIsMenuOpen(false);
        };
        window.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("keydown", onKeyDown);
        return () => {
            window.removeEventListener("scroll", onScroll);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, []);

    const dismiss = () => {
        document.documentElement.style.setProperty("--banner-h", "0px");
        setIsDismissed(true);
    };

    const closeMenu = () => setIsMenuOpen(false);
    const className = [
        "pnch-nav",
        isEnhanced ? "pnch-nav--js" : "",
        isCompact && !isDismissed ? "is-compact" : "",
        isDismissed ? "is-dismissed" : "",
    ]
        .filter(Boolean)
        .join(" ");

    return (
        <header className={className}>
            {!isDismissed && (
                <div className="pnch-nav__banner">
                    <p className="pnch-nav__banner-text">
                        Demo en vivo · Arbitrum Sepolia
                        <span className="pnch-nav__banner-tail">
                            {" "}
                            — la plata del demo es simulada
                        </span>
                    </p>
                    <a className="pnch-nav__banner-link" href="#el-modelo">
                        Qué es real →
                    </a>
                    <button
                        aria-label="Cerrar el aviso"
                        className="pnch-nav__banner-x"
                        onClick={dismiss}
                        type="button"
                    >
                        ×
                    </button>
                </div>
            )}
            <div className="pnch-nav__bar">
                <div className="pnch-nav__inner">
                    <a
                        aria-label="PUNCH"
                        className="pnch-nav__brand"
                        href="#top"
                    >
                        <span>P</span>
                        <span
                            aria-hidden="true"
                            className="pnch-nav__brand-hole"
                        />
                        <span>NCH</span>
                    </a>
                    <button
                        aria-controls="landing-menu"
                        aria-expanded={isMenuOpen}
                        aria-label={isMenuOpen ? "Cerrar menú" : "Abrir menú"}
                        className="pnch-nav__menu-button"
                        onClick={() => setIsMenuOpen((open) => !open)}
                        type="button"
                    >
                        <span aria-hidden="true">☰</span>
                    </button>
                    <nav
                        aria-label="Navegación principal"
                        className={
                            isMenuOpen
                                ? "pnch-nav__menu is-open"
                                : "pnch-nav__menu"
                        }
                        id="landing-menu"
                    >
                        <ul className="pnch-nav__links">
                            <li>
                                <a
                                    className="pnch-nav__link"
                                    href="#como-funciona"
                                    onClick={closeMenu}
                                >
                                    {LANDING_COPY.nav.how}
                                </a>
                            </li>
                            <li>
                                <a
                                    className="pnch-nav__link"
                                    href="#para-tu-cafe"
                                    onClick={closeMenu}
                                >
                                    {LANDING_COPY.nav.cafe}
                                </a>
                            </li>
                            <li>
                                <a
                                    className="pnch-nav__link"
                                    href="#el-modelo"
                                    onClick={closeMenu}
                                >
                                    {LANDING_COPY.nav.model}
                                </a>
                            </li>
                            <li>
                                <a
                                    className="pnch-cta pnch-nav__join"
                                    href={LANDING_LINKS.cafe}
                                    onClick={closeMenu}
                                >
                                    {LANDING_COPY.nav.primaryCta}
                                </a>
                            </li>
                            <li>
                                <a
                                    className="pnch-nav__signin"
                                    href={LANDING_LINKS.signIn}
                                    onClick={closeMenu}
                                >
                                    Entrar
                                </a>
                            </li>
                        </ul>
                    </nav>
                </div>
            </div>
        </header>
    );
}
