"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { authClient } from "@/frontend/auth/auth";
import { Button } from "@/frontend/components/ui/button";

export function SignOutButton() {
    const router = useRouter();
    const queryClient = useQueryClient();
    return (
        <Button
            variant="outline"
            size="sm"
            onClick={async () => {
                await authClient.signOut();
                queryClient.clear();
                router.push("/auth/sign-in");
            }}
        >
            Cerrar sesión
        </Button>
    );
}
