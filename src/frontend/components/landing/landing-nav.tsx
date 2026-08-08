"use client";

import { useEffect, useRef, useState } from "react";

const COMPACT_THRESHOLD = 48;

/**
 * N12 — announcement banner stacked above one real nav.
 *
 * The banner carries the demo's honest disclosure (testnet, simulated
 * money) so it can't be missed or buried. Scrolling down retracts it and
 * docks the bar; scrolling up brings it back; the × removes it for good
 * and zeroes `--banner-h` so the hero's padding reflows with no gap.
 */
export function LandingNav() {
    const [isCompact, setIsCompact] = useState(false);
    const [isDismissed, setIsDismissed] = useState(false);
    const lastY = useRef(0);

    useEffect(() => {
        const onScroll = () => {
            const y = window.scrollY;
            if (y <= COMPACT_THRESHOLD) {
                setIsCompact(false);
            } else if (y > lastY.current) {
                setIsCompact(true);
            } else if (y < lastY.current) {
                setIsCompact(false);
            }
            lastY.current = y;
        };

        window.addEventListener("scroll", onScroll, { passive: true });
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const dismiss = () => {
        document.documentElement.style.setProperty("--banner-h", "0px");
        setIsDismissed(true);
    };

    const className = [
        "pnch-nav",
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

                    <ul className="pnch-nav__links">
                        <li>
                            <a className="pnch-nav__link" href="#como-funciona">
                                Cómo funciona
                            </a>
                        </li>
                        <li>
                            <a className="pnch-nav__link" href="#para-tu-cafe">
                                Para tu café
                            </a>
                        </li>
                        <li>
                            <a className="pnch-nav__link" href="#el-modelo">
                                El modelo
                            </a>
                        </li>
                    </ul>

                    <a className="pnch-cta pnch-nav__cta" href="/auth/sign-in">
                        Entrar
                    </a>
                </div>
            </div>
        </header>
    );
}
