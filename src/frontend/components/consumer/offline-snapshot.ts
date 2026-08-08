const PREFIX = "punch:snapshot:";
const keyFor = (userId: string, screen: string) =>
    `${PREFIX}${userId}:${screen}`;

export function writePunchSnapshot(
    storage: Storage,
    userId: string,
    screen: string,
    value: unknown,
): void {
    try {
        storage.setItem(keyFor(userId, screen), JSON.stringify(value));
    } catch {
        // Offline reads are best-effort; quota and privacy-mode errors are non-fatal.
    }
}

export function readPunchSnapshot<T>(
    storage: Storage,
    userId: string,
    screen: string,
): T | null {
    let raw: string | null;
    try {
        raw = storage.getItem(keyFor(userId, screen));
    } catch {
        return null;
    }
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        try {
            storage.removeItem(keyFor(userId, screen));
        } catch {
            // A broken storage implementation must not break the read path.
        }
        return null;
    }
}

export function clearPunchSnapshots(storage: Storage): void {
    let keys: string[] = [];
    try {
        keys = Array.from({ length: storage.length }, (_, index) =>
            storage.key(index),
        ).filter((key): key is string => key?.startsWith(PREFIX) === true);
    } catch {
        return;
    }
    for (const key of keys) {
        try {
            storage.removeItem(key);
        } catch {
            // Continue clearing other snapshots when one key is inaccessible.
        }
    }
}
