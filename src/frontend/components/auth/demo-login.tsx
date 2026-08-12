"use client";

import { Button } from "@/frontend/components/ui/button";
import { useDemoSignIn } from "./use-demo-sign-in";

import { ClientConfig } from "@/config/client-config";

const DEMO_LOGINS = [
    { label: "Entrar como consumidor demo", email: "demo-consumer@punch.pe" },
    { label: "Entrar como Café Brújula", email: "brujula@punch.pe" },
    { label: "Entrar como Ops", email: "demo-ops@punch.pe" },
] as const;

export function DemoLogin() {
    const { signInAs, pending, error } = useDemoSignIn();

    if (!ClientConfig.demoMode || !ClientConfig.demoPassword) {
        return null;
    }

    return (
        <div className="mt-6 flex flex-col gap-2">
            <p className="text-center text-sm text-muted-foreground">
                Probar demo
            </p>
            {DEMO_LOGINS.map((demo) => (
                <Button
                    key={demo.email}
                    variant="outline"
                    disabled={pending !== null}
                    onClick={() => {
                        void signInAs(demo.email, "/home");
                    }}
                >
                    {pending === demo.email ? "Entrando…" : demo.label}
                </Button>
            ))}
            {error ? (
                <p className="text-center text-sm text-destructive">{error}</p>
            ) : null}
        </div>
    );
}
