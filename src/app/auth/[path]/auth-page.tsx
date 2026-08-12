"use client";

import { ClientConfig } from "@/config/client-config";
import { Auth } from "@/frontend/components/auth/auth";
import { DemoLogin } from "@/frontend/components/auth/demo-login";

export function AuthPageClient({ path }: { path: string }) {
    if (!ClientConfig.demoMode) {
        return <Auth path={path} />;
    }

    return (
        <>
            <DemoLogin />
            <details>
                <summary>Entrar con email y contraseña</summary>
                <Auth path={path} />
            </details>
        </>
    );
}
