// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    clearPendingProofUrl,
    DEMO_STATE_KEY,
    emptyDemoState,
    parseDemoState,
    readDemoState,
    setPendingProofUrl,
} from "../demo-state";

describe("demo-state", () => {
    beforeEach(() => {
        window.localStorage.clear();
        clearPendingProofUrl();
        window.localStorage.clear();
    });

    it("parses a stored pending proof url", () => {
        expect(
            parseDemoState('{"pendingProofUrl":"http://x/purchase/abc"}'),
        ).toEqual({ pendingProofUrl: "http://x/purchase/abc" });
    });

    it("falls back to the empty state on missing or broken payloads", () => {
        expect(parseDemoState(null)).toEqual(emptyDemoState);
        expect(parseDemoState("not json")).toEqual(emptyDemoState);
        expect(parseDemoState('{"pendingProofUrl":42}')).toEqual(
            emptyDemoState,
        );
    });

    it("persists and clears the pending proof url", () => {
        setPendingProofUrl("http://x/purchase/abc");
        expect(readDemoState().pendingProofUrl).toBe("http://x/purchase/abc");
        expect(window.localStorage.getItem(DEMO_STATE_KEY)).toContain(
            "/purchase/abc",
        );

        clearPendingProofUrl();
        expect(readDemoState().pendingProofUrl).toBeNull();
    });

    it("notifies listeners when the state changes", () => {
        const listener = vi.fn();
        window.addEventListener("punch:demo-state", listener);
        setPendingProofUrl("http://x/purchase/abc");
        window.removeEventListener("punch:demo-state", listener);

        expect(listener).toHaveBeenCalled();
    });
});
