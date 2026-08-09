export function sanitizeMessage(message: string): string {
    return message
        .replace(
            /([a-z][a-z\d+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
            "$1[redacted]@",
        )
        .replace(
            /([?&](?:token|secret|password|passwd|key|api[_-]?key|authorization|mnemonic|private[_-]?key)=)[^&#\s]+/gi,
            "$1[redacted]",
        )
        .replace(/\b(bearer)\s+[^\s,;]+/gi, "$1 [redacted]")
        .replace(
            /\b(password|passwd|token|secret|mnemonic|private[_-]?key|api[_-]?key|authorization)\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi,
            "$1=[redacted]",
        );
}

export function normalizeError(error: unknown): {
    name: string;
    message: string;
    code?: string | number;
} {
    if (error instanceof Error) {
        const code = (error as Error & { code?: unknown }).code;
        const normalized = {
            name: error.name,
            message: sanitizeMessage(error.message),
        };
        if (typeof code === "string" || typeof code === "number") {
            return { ...normalized, code };
        }
        return normalized;
    }
    return { name: "Error", message: "Unknown error" };
}
