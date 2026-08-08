export function toNonceHex(bytes: Uint8Array): `0x${string}` {
    if (bytes.length !== 32) throw new Error("nonce must be 32 bytes");
    return `0x${Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("")}` as `0x${string}`;
}

export function generateNonce(): `0x${string}` {
    return toNonceHex(crypto.getRandomValues(new Uint8Array(32)));
}
