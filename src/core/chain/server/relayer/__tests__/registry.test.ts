import { describe, expect, it } from "vitest";
import { handlerFor } from "../handlers/registry";

describe("handler registry", () => {
    it("returns the handler registered for a kind", () => {
        expect(handlerFor("consumption_record").kind).toBe(
            "consumption_record",
        );
    });

    it("throws for a kind with no handler yet", () => {
        expect(() => handlerFor("campaign_create")).toThrow(
            /unsupported relayer job kind/,
        );
    });

    it("signs consumption jobs with the relayer key", () => {
        expect(handlerFor("consumption_record").signer({} as never)).toEqual({
            kind: "relayer",
        });
    });

    it("throws on an unknown kind", () => {
        expect(() => handlerFor("nope" as never)).toThrow();
    });
});
