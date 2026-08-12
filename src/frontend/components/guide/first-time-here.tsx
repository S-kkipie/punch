"use client";

import { useEffect, useState } from "react";

import { ClientConfig } from "@/config/client-config";
import { useDemoSignIn } from "@/frontend/components/auth/use-demo-sign-in";
import { Button } from "@/frontend/components/ui/button";
import { DemoOnly } from "./demo-only";

const DISMISS_KEY = "punch-demo-terminal-intro-dismissed";

export function FirstTimeHere() {
    const { signInAs, pending, error } = useDemoSignIn();
    const [isVisible, setIsVisible] = useState(false);

    useEffect(() => {
        if (!ClientConfig.demoMode) {
            return;
        }

        const dismissed = sessionStorage.getItem(DISMISS_KEY) === "true";
        if (!dismissed) {
            setIsVisible(true);
        }
    }, []);

    if (!ClientConfig.demoMode || !isVisible) {
        return null;
    }

    return (
        <section className="mx-auto w-full max-w-md rounded-lg border border-dashed border-[var(--color-rule)] p-4">
            <h2 className="consumer-title text-lg">¿Primera vez aquí?</h2>
            <p className="mt-2 text-sm text-muted-foreground">
                La terminal es el lado cafetería: aquí se generan los códigos
                que el cliente escanea. Si aún no conoces el lado cliente,
                empieza por ahí.
            </p>
            <DemoOnly />
            <div className="mt-4 flex flex-wrap gap-2">
                <Button
                    onClick={() => {
                        void signInAs("demo-consumer@punch.pe", "/home");
                    }}
                    disabled={pending !== null}
                >
                    {pending !== null ? "Entrando…" : "Empezar como cliente"}
                </Button>
                <Button
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => {
                        sessionStorage.setItem(DISMISS_KEY, "true");
                        setIsVisible(false);
                    }}
                >
                    Quedarme aquí
                </Button>
            </div>
            {error ? (
                <p className="mt-2 text-sm text-destructive">{error}</p>
            ) : null}
        </section>
    );
}
