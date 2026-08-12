"use client";

import { useState } from "react";

import { ClientConfig } from "@/config/client-config";
import { authClient } from "@/frontend/auth/auth";

const DEMO_ERROR_COPY =
    "No se pudo iniciar la demo. ¿Corriste pnpm db:seed?";

export function useDemoSignIn() {
    const [pending, setPending] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    async function signInAs(email: string, destination: string): Promise<void> {
        const password = ClientConfig.demoPassword;
        if (!password) {
            setError(DEMO_ERROR_COPY);
            return;
        }

        setPending(email);
        setError(null);

        const { error: signInError } = await authClient.signIn.email({
            email,
            password,
        });

        if (signInError) {
            setError(DEMO_ERROR_COPY);
            setPending(null);
            return;
        }

        window.location.assign(destination);
    }

    return { signInAs, pending, error };
}
