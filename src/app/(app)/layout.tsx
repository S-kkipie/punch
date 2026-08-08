import type { PropsWithChildren } from "react";
import { requireAuth } from "@/server/auth/require-auth";
import { SignOutButton } from "./sign-out-button";

export default async function AppLayout({ children }: PropsWithChildren) {
    const { user } = await requireAuth();
    return (
        <div className="min-h-svh">
            <header className="flex flex-wrap items-center justify-between gap-3 border-b px-6 py-3">
                <div className="flex items-center gap-5">
                    <span className="font-semibold">PUNCH</span>
                    <nav className="flex items-center gap-3 text-sm">
                        <a href="/cafe">Cafés</a>
                        <a href="/discover">Descubrir</a>
                        {user.isOps && <a href="/ops">Ops</a>}
                    </nav>
                </div>
                <div className="flex items-center gap-3 text-muted-foreground text-sm">
                    <span>{user.email}</span>
                    <SignOutButton />
                </div>
            </header>
            <main>{children}</main>
        </div>
    );
}
