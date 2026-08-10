import { describe, expect, it } from "vitest";
import { handlerFor } from "../handlers/registry";

describe("handler registry", () => {
    it("returns the handler registered for a kind", () => {
        expect(handlerFor("consumption_record").kind).toBe(
            "consumption_record",
        );
    });

    it("maps the legacy consumption kind to the consumption handler", () => {
        expect(handlerFor("consumption")).toBe(
            handlerFor("consumption_record"),
        );
    });

    it("returns the campaign create handler", () => {
        expect(handlerFor("campaign_create").kind).toBe("campaign_create");
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
