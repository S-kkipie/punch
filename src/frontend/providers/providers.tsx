"use client";

import { QueryClientProvider } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { type PropsWithChildren, Suspense } from "react";
import { authClient } from "@/frontend/auth/auth";
import { AuthProvider } from "@/frontend/components/auth/auth-provider";
import { Toaster } from "@/frontend/components/ui/sonner";
import { apiClient, EdenProvider } from "@/frontend/lib/eden";
import { getQueryClient } from "@/frontend/lib/query-client";
import { authRedirectTarget, DEFAULT_REDIRECT } from "./auth-redirect";
import { ThemeProvider } from "./theme-provider";

// `useSearchParams` opts a client component out of static prerendering, so it
// lives in this leaf instead of `Providers`. Without the split, every static
// page in the app bails out to client rendering and `next build` fails on
// `/_not-found`.
function AuthProviderWithRedirect({ children }: PropsWithChildren) {
    const searchParams = useSearchParams();
    return (
        <AuthShell
            redirectTo={authRedirectTarget(searchParams.get("redirect"))}
        >
            {children}
        </AuthShell>
    );
}

function AuthShell({
    children,
    redirectTo,
}: PropsWithChildren<{ redirectTo: string }>) {
    const router = useRouter();
    return (
        <AuthProvider
            authClient={authClient}
            redirectTo={redirectTo}
            emailAndPassword={{
                enabled: true,
                forgotPassword: true,
            }}
            navigate={({ to, replace }) =>
                replace ? router.replace(to) : router.push(to)
            }
            Link={Link}
        >
            {children}
            <Toaster />
        </AuthProvider>
    );
}

export function Providers({ children }: PropsWithChildren) {
    const queryClient = getQueryClient();

    return (
        <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
        >
            <NuqsAdapter>
                <QueryClientProvider client={queryClient}>
                    <EdenProvider client={apiClient} queryClient={queryClient}>
                        <Suspense
                            fallback={
                                <AuthShell redirectTo={DEFAULT_REDIRECT}>
                                    {children}
                                </AuthShell>
                            }
                        >
                            <AuthProviderWithRedirect>
                                {children}
                            </AuthProviderWithRedirect>
                        </Suspense>
                    </EdenProvider>
                </QueryClientProvider>
            </NuqsAdapter>
        </ThemeProvider>
    );
}
