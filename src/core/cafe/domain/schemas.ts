import { z } from "zod";

const decimalString = z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "Monto inválido (usa formato 10.50)");

const positiveDecimal = decimalString.refine((v) => Number(v) > 0, {
    message: "El precio debe ser mayor a 0",
});

/**
 * Una foto es una URL absoluta (la que sube la cafetería) o una ruta servida
 * por la propia app, como `/cafes/brujula-cafe.jpg` para las fotos del demo.
 */
export const photoUrlSchema = z
    .string()
    .trim()
    .refine(
        (value) => value.startsWith("/") || URL.canParse(value),
        "URL inválida",
    );

export const cafeOnboardingStatusSchema = z.enum([
    "draft",
    "submitted",
    "approved",
    "rejected",
]);
export const productTypeSchema = z.enum(["emission", "reward"]);
export const productApprovalSchema = z.enum([
    "pending",
    "approved",
    "rejected",
]);

export const createCafeSchema = z.object({
    name: z.string().trim().min(1, "Nombre requerido").max(120),
    description: z.string().trim().max(500).optional(),
});

export const updateCafeSchema = z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).nullish(),
    address: z.string().trim().max(200).nullish(),
    district: z.string().trim().max(80).nullish(),
    lat: z.string().nullish(),
    lng: z.string().nullish(),
    photoUrl: photoUrlSchema.nullish(),
    ruc: z
        .string()
        .trim()
        .regex(/^\d{11}$/, "RUC de 11 dígitos")
        .nullish(),
    contactPhone: z.string().trim().min(6).max(20).nullish(),
});

/** Public wire shape — NO ruc / contactPhone. */
export const cafeSchema = z.object({
    id: z.string(),
    name: z.string(),
    slug: z.string(),
    description: z.string().nullable(),
    address: z.string().nullable(),
    district: z.string().nullable(),
    lat: z.string().nullable(),
    lng: z.string().nullable(),
    photoUrl: z.string().nullable(),
    onboardingStatus: cafeOnboardingStatusSchema,
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** Owner/ops wire shape — includes PII + review note. */
export const cafeAdminSchema = cafeSchema.extend({
    ruc: z.string().nullable(),
    contactPhone: z.string().nullable(),
    reviewNote: z.string().nullable(),
});

export const reviewSchema = z
    .object({
        decision: z.enum(["approved", "rejected"]),
        reviewNote: z.string().trim().max(500).optional(),
    })
    .refine((r) => r.decision !== "rejected" || !!r.reviewNote, {
        message: "Un rechazo debe incluir una razón accionable",
        path: ["reviewNote"],
    });

const productBase = z.object({
    name: z.string().trim().min(1, "Nombre requerido").max(120),
    description: z.string().trim().max(300).optional(),
    priceSoles: positiveDecimal,
    cogsSoles: decimalString.optional(),
    type: productTypeSchema,
});

const rewardRules = (
    p: { type: string; priceSoles: string; cogsSoles?: string },
    ctx: z.RefinementCtx,
) => {
    if (p.type !== "reward") return;
    if (Number(p.priceSoles) > 12) {
        ctx.addIssue({
            code: "custom",
            path: ["priceSoles"],
            message:
                "Un producto reward no puede superar S/12 de precio retail",
        });
    }
    if (!p.cogsSoles) {
        ctx.addIssue({
            code: "custom",
            path: ["cogsSoles"],
            message: "Un producto reward requiere COGS",
        });
    }
};

export const createProductSchema = productBase.superRefine(rewardRules);
export const updateProductSchema = productBase
    .partial()
    .extend({ active: z.boolean().optional() });
// Note: full reward re-validation on update happens in the service, which
// merges the patch onto the existing row and re-runs createProductSchema.

export const productSchema = z.object({
    id: z.string(),
    cafeId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    priceSoles: z.string(),
    cogsSoles: z.string().nullable(),
    type: productTypeSchema,
    approvalStatus: productApprovalSchema,
    active: z.boolean(),
    createdAt: z.string(),
    updatedAt: z.string(),
});

/** Owner/ops wire shape — includes review note. */
export const productAdminSchema = productSchema.extend({
    reviewNote: z.string().nullable(),
});
