export function isDemoSeedEnabled(
    env: Record<string, string | undefined> = process.env,
): boolean {
    return env.NEXT_PUBLIC_DEMO_MODE === "true";
}
