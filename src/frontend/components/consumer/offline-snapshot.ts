const PREFIX = "punch:snapshot:";
const keyFor = (userId: string, screen: string) =>
    `${PREFIX}${userId}:${screen}`;

export function writePunchSnapshot(
    storage: Storage,
    userId: string,
    screen: string,
    value: unknown,
): void {
    storage.setItem(keyFor(userId, screen), JSON.stringify(value));
}

export function readPunchSnapshot<T>(
    storage: Storage,
    userId: string,
    screen: string,
): T | null {
    const raw = storage.getItem(keyFor(userId, screen));
    if (!raw) return null;
    try {
        return JSON.parse(raw) as T;
    } catch {
        storage.removeItem(keyFor(userId, screen));
        return null;
    }
}

export function clearPunchSnapshots(storage: Storage): void {
    const keys = Array.from({ length: storage.length }, (_, index) =>
        storage.key(index),
    ).filter((key): key is string => key?.startsWith(PREFIX) === true);
    for (const key of keys) storage.removeItem(key);
}
