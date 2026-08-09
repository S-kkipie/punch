export function authRedirectTarget(redirect: string | null): string {
    return redirect?.startsWith("/") ? redirect : "/home";
}
