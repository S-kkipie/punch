"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ClientConfig } from "@/config/client-config";
import { authClient } from "@/frontend/auth/auth";
import { Button } from "@/frontend/components/ui/button";

const DEMO_LOGINS = [
    { label: "Entrar como consumidor demo", email: "demo-consumer@punch.pe" },
    { label: "Entrar como Café Brújula", email: "brujula@punch.pe" },
    { label: "Entrar como Ops", email: "demo-ops@punch.pe" },
] as const;

export function DemoLogin() {
    const router = useRouter();
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    if (!ClientConfig.demoMode || !ClientConfig.demoPassword) {
        return null;
    }
    const password = ClientConfig.demoPassword;

    async function signInAs(email: string) {
        setPending(email);
        setError(null);
        const { error: signInError } = await authClient.signIn.email({
            email,
            password,
        });
        if (signInError) {
            setError("No se pudo iniciar la demo. ¿Corriste pnpm db:seed?");
            setPending(null);
            return;
        }
        router.push("/home");
        router.refresh();
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
                    onClick={() => signInAs(demo.email)}
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
