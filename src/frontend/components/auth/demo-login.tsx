"use client";

import { Button } from "@/frontend/components/ui/button";
import { DemoOnly } from "@/frontend/components/guide/demo-only";
import { useDemoSignIn } from "./use-demo-sign-in";

import { ClientConfig } from "@/config/client-config";

const DEMO_LOGINS = [
    {
        email: "demo-consumer@punch.pe",
        destination: "/home",
        label: "Cliente",
        description: "Escanea códigos, junta sellos y canjea café.",
    },
    {
        email: "brujula@punch.pe",
        destination: "/cafe",
        label: "Cafetería (Café Brújula)",
        description: "Genera códigos de compra y entrega canjes.",
    },
] as const;

export function DemoLogin() {
    const { signInAs, pending, error } = useDemoSignIn();

    if (!ClientConfig.demoMode || !ClientConfig.demoPassword) {
        return null;
    }

    return (
        <section className="mt-6 flex flex-col gap-3">
            <DemoOnly />
            <div>
                <h2 className="consumer-title text-xl font-bold">PUNCH · demo guiada</h2>
                <p className="text-sm text-muted-foreground">
                    Elige un rol para recorrer la plataforma. Puedes cambiar de rol en
                    cualquier momento desde la barra superior.
                </p>
            </div>
            {DEMO_LOGINS.map((demo) => (
                <Button
                    key={demo.email}
                    variant="outline"
                    className="h-auto min-h-16 flex-col items-start gap-0 p-3"
                    disabled={pending !== null}
                    onClick={() => {
                        void signInAs(demo.email, demo.destination);
                    }}
                >
                    <span>{pending === demo.email ? "Entrando…" : demo.label}</span>
                    <span className="text-xs text-muted-foreground">
                        {demo.description}
                    </span>
                </Button>
            ))}
            {error ? (
                <p className="text-center text-sm text-destructive">{error}</p>
            ) : null}
        </section>
    );
}
