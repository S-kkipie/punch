"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";
import { ClientConfig } from "@/config/client-config";
import { useDemoSignIn } from "@/frontend/components/auth/use-demo-sign-in";
import { DemoOnly } from "./demo-only";

const DEMO_ROLE_TEXT = {
    consumer: "Cliente",
    cafe: "Cafetería",
} as const;

type DemoRole = keyof typeof DEMO_ROLE_TEXT;

type TransferDirection = Exclude<DemoRole, "" | null>;

const ROLE_COPY = {
    toCafe: "Vas a pasar al lado cafetería (Café Brújula). Ahí generas códigos de compra y entregas canjes. Primer paso: abrir la terminal y generar un código.",
    toConsumer:
        "Vas a volver al lado cliente. Ahí escaneas códigos, juntas sellos y pides canjes. Primer paso: revisar tu progreso en Inicio.",
} as const;

export function DemoBar() {
    const pathname = usePathname();
    const [pendingTransfer, setPendingTransfer] =
        useState<TransferDirection | null>(null);

    const { signInAs, pending, error } = useDemoSignIn();

    if (!ClientConfig.demoMode || !ClientConfig.demoPassword) {
        return null;
    }

    const activeRole: DemoRole =
        pathname.startsWith("/cafe") || pathname.startsWith("/ops")
            ? "cafe"
            : "consumer";
    const otherRole: DemoRole = activeRole === "cafe" ? "consumer" : "cafe";

    const isPending = pending !== null;

    async function startTransfer(role: TransferDirection) {
        if (isPending) {
            return;
        }
        setPendingTransfer(role);
    }

    const targetRole: DemoRole = pendingTransfer ?? otherRole;
    const isCafeTransfer = targetRole === "cafe";
    const targetEmail = isCafeTransfer
        ? "brujula@punch.pe"
        : "demo-consumer@punch.pe";
    const targetDestination = isCafeTransfer ? "/cafe" : "/home";
    const transferLabel =
        targetRole === "cafe" ? "Cambiar a Cafetería" : "Cambiar a Cliente";
    const transferCopy =
        targetRole === "cafe" ? ROLE_COPY.toCafe : ROLE_COPY.toConsumer;

    return (
        <aside className="demo-bar" aria-label="Barra de demo">
            <div className="demo-bar__line">
                <p className="demo-bar__role">
                    <span className="demo-bar__dot" aria-hidden="true" />
                    Rol activo: <strong>{DEMO_ROLE_TEXT[activeRole]}</strong>
                </p>

                <div className="demo-bar__actions">
                    <div className="demo-bar__switch">
                        {[
                            { role: "consumer" as const },
                            { role: "cafe" as const },
                        ].map(({ role }) => {
                            const label = DEMO_ROLE_TEXT[role];
                            const isCurrent = role === activeRole;
                            return (
                                <button
                                    key={role}
                                    type="button"
                                    className="demo-bar__role-btn"
                                    disabled={isPending || isCurrent}
                                    aria-pressed={isCurrent ? "true" : "false"}
                                    onClick={() => {
                                        if (!isCurrent) {
                                            void startTransfer(role);
                                        }
                                    }}
                                >
                                    {label}
                                </button>
                            );
                        })}
                    </div>

                    <DemoOnly />
                </div>
            </div>

            {error ? <p className="demo-bar__error">{error}</p> : null}

            {pendingTransfer ? (
                <section className="demo-bar__panel" aria-live="polite">
                    <p>{transferCopy}</p>
                    <div className="demo-bar__panel-actions">
                        <button
                            type="button"
                            className="demo-bar__confirm"
                            disabled={isPending}
                            onClick={() =>
                                void signInAs(targetEmail, targetDestination)
                            }
                        >
                            {isPending ? "Cambiando…" : transferLabel}
                        </button>
                        <button
                            type="button"
                            className="demo-bar__skip"
                            disabled={isPending}
                            onClick={() => {
                                setPendingTransfer(null);
                            }}
                        >
                            Quedarme
                        </button>
                    </div>
                </section>
            ) : null}
        </aside>
    );
}
