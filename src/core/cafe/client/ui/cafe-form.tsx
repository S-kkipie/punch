"use client";

import type { AnyFieldApi } from "@tanstack/react-form";
import { z } from "zod";
import { Button } from "@/frontend/components/ui/button";
import { Field, FieldError } from "@/frontend/components/ui/field";
import { Input } from "@/frontend/components/ui/input";
import { Label } from "@/frontend/components/ui/label";
import { Textarea } from "@/frontend/components/ui/textarea";
import { useAppForm } from "@/frontend/hooks/use-tanstack-form";

export const cafeFormSchema = z.object({
    name: z.string().trim().min(1, "Nombre requerido"),
    description: z.string().max(500),
    address: z.string().max(200),
    district: z.string().max(80),
    contactPhone: z.string().trim().min(6).max(20),
    ruc: z.string().regex(/^$|^\d{11}$/, "RUC de 11 dígitos"),
    photoUrl: z.union([z.literal(""), z.url("URL inválida")]),
});

export type CafeFormValues = z.infer<typeof cafeFormSchema>;

const emptyValues: CafeFormValues = {
    name: "",
    description: "",
    address: "",
    district: "",
    contactPhone: "",
    ruc: "",
    photoUrl: "",
};

function fieldErrors(field: AnyFieldApi) {
    return field.state.meta.errors.map((error) => ({
        message: String(error?.message ?? error),
    }));
}

export function CafeForm({
    defaultValues,
    onSubmit,
    disabled,
    fields: visibleFields,
}: {
    defaultValues?: Partial<CafeFormValues>;
    onSubmit: (values: CafeFormValues) => void | Promise<void>;
    disabled?: boolean;
    fields?: (keyof CafeFormValues)[];
}) {
    const form = useAppForm({
        defaultValues: { ...emptyValues, ...defaultValues },
        validators: { onChange: cafeFormSchema },
        onSubmit: async ({ value }) => onSubmit(value),
    });

    const fields: {
        name: keyof CafeFormValues;
        label: string;
        placeholder: string;
        multiline?: boolean;
    }[] = [
        { name: "name", label: "Nombre", placeholder: "Nombre del café" },
        {
            name: "description",
            label: "Descripción",
            placeholder: "Cuéntanos sobre tu café",
            multiline: true,
        },
        { name: "address", label: "Dirección", placeholder: "Dirección" },
        { name: "district", label: "Distrito", placeholder: "Distrito" },
        {
            name: "contactPhone",
            label: "Teléfono de contacto",
            placeholder: "+51 999 999 999",
        },
        { name: "ruc", label: "RUC", placeholder: "11 dígitos" },
        {
            name: "photoUrl",
            label: "URL de foto",
            placeholder: "https://...",
        },
    ];

    const fieldsToRender = visibleFields
        ? fields.filter((field) => visibleFields.includes(field.name))
        : fields;

    return (
        <form
            className="space-y-4"
            onSubmit={(event) => {
                event.preventDefault();
                form.handleSubmit();
            }}
        >
            {fieldsToRender.map((config) => (
                <form.Field key={config.name} name={config.name}>
                    {(field) => {
                        const invalid = !field.state.meta.isValid;
                        return (
                            <Field data-invalid={invalid}>
                                <Label htmlFor={field.name}>
                                    {config.label}
                                </Label>
                                {config.multiline ? (
                                    <Textarea
                                        id={field.name}
                                        name={field.name}
                                        value={field.state.value}
                                        onBlur={field.handleBlur}
                                        onChange={(event) =>
                                            field.handleChange(
                                                event.target.value,
                                            )
                                        }
                                        placeholder={config.placeholder}
                                        aria-invalid={invalid}
                                    />
                                ) : (
                                    <Input
                                        id={field.name}
                                        name={field.name}
                                        value={field.state.value}
                                        onBlur={field.handleBlur}
                                        onChange={(event) =>
                                            field.handleChange(
                                                event.target.value,
                                            )
                                        }
                                        placeholder={config.placeholder}
                                        aria-invalid={invalid}
                                    />
                                )}
                                {invalid && (
                                    <FieldError errors={fieldErrors(field)} />
                                )}
                            </Field>
                        );
                    }}
                </form.Field>
            ))}
            <form.Subscribe selector={(state) => state.canSubmit}>
                {(canSubmit) => (
                    <Button type="submit" disabled={disabled || !canSubmit}>
                        {disabled ? "Guardando…" : "Guardar café"}
                    </Button>
                )}
            </form.Subscribe>
        </form>
    );
}
