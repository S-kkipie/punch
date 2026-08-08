import type { z } from "zod";
import type {
    cafeAdminSchema,
    cafeOnboardingStatusSchema,
    cafeSchema,
    createCafeSchema,
    createProductSchema,
    productAdminSchema,
    productSchema,
    reviewSchema,
    updateCafeSchema,
    updateProductSchema,
} from "./schemas";

export type CafeOnboardingStatus = z.infer<typeof cafeOnboardingStatusSchema>;
export type CreateCafe = z.infer<typeof createCafeSchema>;
export type UpdateCafe = z.infer<typeof updateCafeSchema>;
export type Cafe = z.infer<typeof cafeSchema>;
export type CafeAdmin = z.infer<typeof cafeAdminSchema>;
export type Review = z.infer<typeof reviewSchema>;
export type CreateProduct = z.infer<typeof createProductSchema>;
export type UpdateProduct = z.infer<typeof updateProductSchema>;
export type Product = z.infer<typeof productSchema>;
export type ProductAdmin = z.infer<typeof productAdminSchema>;
