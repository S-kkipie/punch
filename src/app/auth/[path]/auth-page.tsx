"use client";

import { ClientConfig } from "@/config/client-config";
import { Auth } from "@/frontend/components/auth/auth";
import { DemoLogin } from "@/frontend/components/auth/demo-login";
import { PageIntro } from "@/frontend/components/guide/page-intro";

export function AuthPageClient({ path }: { path: string }) {
    if (!ClientConfig.demoMode) {
        return <Auth path={path} />;
    }

    return (
        <div className="grid gap-6">
            <PageIntro
                eyebrow="Red de cafeterías de barrio"
                title="PUNCH"
                explain="Compras café en cualquier cafetería independiente de la red y ganas sellos. 12 sellos, un café gratis en cualquiera de ellas. Lo que las cadenas hacen solas, aquí lo hacen juntas."
            />
            <DemoLogin />
            <details className="consumer-panel p-4">
                <summary className="text-sm font-semibold">
                    Tengo una cuenta
                </summary>
                <Auth path={path} />
            </details>
        </div>
    );
}
