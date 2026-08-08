"use client";

import type { AnyFieldApi } from "@tanstack/react-form";
import { z } from "zod";
import { createProductSchema } from "@/core/cafe/domain/schemas";
import { Button } from "@/frontend/components/ui/button";
import { Field, FieldError } from "@/frontend/components/ui/field";
import { Input } from "@/frontend/components/ui/input";
import { Label } from "@/frontend/components/ui/label";
import { Textarea } from "@/frontend/components/ui/textarea";
import { useAppForm } from "@/frontend/hooks/use-tanstack-form";

export const productFormSchema = createProductSchema.safeExtend({
    description: z.string().max(300),
    cogsSoles: z.string(),
});
export type ProductFormValues = z.infer<typeof productFormSchema>;

function errors(field: AnyFieldApi) {
    return field.state.meta.errors.map((error) => ({
        message: String(error?.message ?? error),
    }));
}

export function ProductForm({
    onSubmit,
    disabled,
}: {
    onSubmit: (values: ProductFormValues) => void | Promise<void>;
    disabled?: boolean;
}) {
    const form = useAppForm({
        defaultValues: {
            name: "",
            description: "",
            type: "emission" as "emission" | "reward",
            priceSoles: "",
            cogsSoles: "",
        } satisfies ProductFormValues,
        validators: { onChange: productFormSchema },
        onSubmit: async ({ value }) => onSubmit(value),
    });

    return (
        <form
            className="space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                form.handleSubmit();
            }}
        >
            <form.Field name="name">
                {(field) => (
                    <Field data-invalid={!field.state.meta.isValid}>
                        <Label htmlFor={field.name}>Nombre</Label>
                        <Input
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                                field.handleChange(event.target.value)
                            }
                            placeholder="Nombre del producto"
                        />
                        {!field.state.meta.isValid && (
                            <FieldError errors={errors(field)} />
                        )}
                    </Field>
                )}
            </form.Field>
            <form.Field name="description">
                {(field) => (
                    <Field data-invalid={!field.state.meta.isValid}>
                        <Label htmlFor={field.name}>Descripción</Label>
                        <Textarea
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                                field.handleChange(event.target.value)
                            }
                            placeholder="Descripción opcional"
                        />
                        {!field.state.meta.isValid && (
                            <FieldError errors={errors(field)} />
                        )}
                    </Field>
                )}
            </form.Field>
            <form.Field name="type">
                {(field) => (
                    <Field>
                        <Label htmlFor={field.name}>Tipo</Label>
                        <select
                            id={field.name}
                            value={field.state.value}
                            onBlur={field.handleBlur}
                            onChange={(event) =>
                                field.handleChange(
                                    event.target.value as "emission" | "reward",
                                )
                            }
                            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm"
                        >
                            <option value="emission">Emisión</option>
                            <option value="reward">Recompensa</option>
                        </select>
                    </Field>
                )}
            </form.Field>
            <div className="grid gap-4 sm:grid-cols-2">
                <form.Field name="priceSoles">
                    {(field) => (
                        <Field data-invalid={!field.state.meta.isValid}>
                            <Label htmlFor={field.name}>Precio (S/)</Label>
                            <Input
                                id={field.name}
                                inputMode="decimal"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                    field.handleChange(event.target.value)
                                }
                                placeholder="10.00"
                            />
                            {!field.state.meta.isValid && (
                                <FieldError errors={errors(field)} />
                            )}
                        </Field>
                    )}
                </form.Field>
                <form.Field name="cogsSoles">
                    {(field) => (
                        <Field data-invalid={!field.state.meta.isValid}>
                            <Label htmlFor={field.name}>COGS (S/)</Label>
                            <Input
                                id={field.name}
                                inputMode="decimal"
                                value={field.state.value}
                                onBlur={field.handleBlur}
                                onChange={(event) =>
                                    field.handleChange(event.target.value)
                                }
                                placeholder="3.00"
                            />
                            {form.state.values.type === "reward" &&
                                Number(field.state.value) > 3 && (
                                    <p className="text-amber-700 text-sm">
                                        COGS sobre S/3 deja margen directo
                                        negativo (objetivo ≤ S/3)
                                    </p>
                                )}
                            {!field.state.meta.isValid && (
                                <FieldError errors={errors(field)} />
                            )}
                        </Field>
                    )}
                </form.Field>
            </div>
            <form.Subscribe selector={(state) => state.canSubmit}>
                {(canSubmit) => (
                    <Button type="submit" disabled={disabled || !canSubmit}>
                        {disabled ? "Guardando…" : "Agregar producto"}
                    </Button>
                )}
            </form.Subscribe>
        </form>
    );
}
