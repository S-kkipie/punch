export function authRedirectTarget(redirect: string | null): string {
    return redirect?.startsWith("/") &&
        redirect[1] !== "/" &&
        redirect[1] !== "\\"
        ? redirect
        : "/home";
}
