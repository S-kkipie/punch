import { describe, expect, it } from "vitest";
import {
    clearPunchSnapshots,
    readPunchSnapshot,
    writePunchSnapshot,
} from "../offline-snapshot";

const memoryStorage = () => {
    const values = new Map<string, string>();
    return {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
            values.set(key, value);
        },
        removeItem: (key: string) => {
            values.delete(key);
        },
        clear: () => {
            values.clear();
        },
        key: (index: number) => [...values.keys()][index] ?? null,
        get length() {
            return values.size;
        },
    } as Storage;
};

describe("offline snapshots", () => {
    it("isolates data by user and screen", () => {
        const storage = memoryStorage();
        writePunchSnapshot(storage, "user-a", "dashboard", { balance: 11 });
        expect(readPunchSnapshot(storage, "user-a", "dashboard")).toEqual({
            balance: 11,
        });
        expect(readPunchSnapshot(storage, "user-b", "dashboard")).toBeNull();
    });
    it("clears every PUNCH snapshot on logout", () => {
        const storage = memoryStorage();
        writePunchSnapshot(storage, "user-a", "dashboard", { balance: 11 });
        storage.setItem("unrelated", "keep");
        clearPunchSnapshots(storage);
        expect(storage.getItem("unrelated")).toBe("keep");
        expect(readPunchSnapshot(storage, "user-a", "dashboard")).toBeNull();
    });
    it("does not throw for quota, security, malformed, or removal failures", () => {
        const storage = memoryStorage();
        storage.setItem("punch:snapshot:user-a:bad", "{");
        expect(() => readPunchSnapshot(storage, "user-a", "bad")).not.toThrow();
        const throwing = {
            ...storage,
            getItem: () => {
                throw new Error("blocked");
            },
            setItem: () => {
                throw new Error("quota");
            },
            removeItem: () => {
                throw new Error("blocked");
            },
            key: () => {
                throw new Error("blocked");
            },
        } as Storage;
        expect(() =>
            writePunchSnapshot(throwing, "u", "home", {}),
        ).not.toThrow();
        expect(() => readPunchSnapshot(throwing, "u", "home")).not.toThrow();
        expect(() => clearPunchSnapshots(throwing)).not.toThrow();
    });
});
