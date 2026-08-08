import { describe, expect, it } from "vitest";
import { productFormSchema } from "../product-form";

describe("product form schema", () => {
    it("can be imported and validates an emission product", () => {
        expect(() =>
            productFormSchema.parse({
                name: "Café filtrado",
                description: "",
                type: "emission",
                priceSoles: "8.00",
                cogsSoles: "3.00",
            }),
        ).not.toThrow();
    });
});
