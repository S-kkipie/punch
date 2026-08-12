"use client";

import { useDemoSignIn } from "@/frontend/components/auth/use-demo-sign-in";
import { useDemoJourney } from "@/frontend/components/guide/use-demo-journey";
import { DemoOnly } from "./demo-only";
import { blockedLabel, journeySteps } from "./journey-steps";
import { LoadingState } from "./loading-state";

type Role = "cliente" | "cafeteria";
type StepAction = { label: string; href: string };
type DefaultStepAction = StepAction & { blockedReason: string };

const defaultActions: readonly DefaultStepAction[] = [
    {
        label: "Generar código",
        href: "/cafe",
        blockedReason: "ya hay un código vivo",
    },
    {
        label: "Escanear compra",
        href: "/scan",
        blockedReason: "espera un código generado",
    },
    {
        label: "Repetir hasta juntar 12 sellos",
        href: "/scan",
        blockedReason: "no aplica",
    },
    {
        label: "Pide tu canje",
        href: "/redeem",
        blockedReason: "te faltan 12 sellos",
    },
    {
        label: "La cafetería entrega el canje",
        href: "/cafe",
        blockedReason: "espera que el cliente lo pida",
    },
    {
        label: "Ciclo completo: el fondo común se actualiza",
        href: "/history",
        blockedReason: "espera confirmación del canje",
    },
] as const;

const transferByRole: Record<Role, { label: string; mention: string }> = {
    cliente: {
        label: "Cafetería",
        mention: "la cafetería",
    },
    cafeteria: {
        label: "Cliente",
        mention: "el cliente",
    },
};

function toAction(
    step: number,
    actionOverride?: StepAction,
): StepAction & { blocked: boolean; disabledLabel: string } {
    const fallback = defaultActions[step] ?? defaultActions[0];

    if (actionOverride) {
        return {
            ...actionOverride,
            blocked: false,
            disabledLabel: actionOverride.label,
        };
    }

    const blocked = step === 2;
    return {
        ...fallback,
        blocked,
        disabledLabel: blocked
            ? blockedLabel(fallback.label, fallback.blockedReason)
            : fallback.label,
    };
}

export function JourneyCard({
    currentRole,
    actionOverride,
}: {
    currentRole: Role;
    actionOverride?: StepAction;
}) {
    const { loading, step } = useDemoJourney();
    const { signInAs } = useDemoSignIn();

    if (loading) {
        return <LoadingState label="Cargando estado de la demo" lines={3} />;
    }

    const currentStep = journeySteps[step] ?? journeySteps[0];
    const action = toAction(step, actionOverride);

    if (currentStep.role === currentRole) {
        return (
            <section className="journey" aria-label="Guía de avance de la demo">
                <ol className="journey__list">
                    {journeySteps.map((entry, index) => {
                        const statusClass =
                            index < step
                                ? "journey__step--done"
                                : index === step
                                  ? "journey__step--current"
                                  : "journey__step--future";

                        return (
                            <li
                                key={entry.title}
                                className={`journey__step ${statusClass}`}
                            >
                                {index < step ? (
                                    <s>{entry.title}</s>
                                ) : (
                                    <span>{entry.title}</span>
                                )}
                            </li>
                        );
                    })}
                </ol>

                <a
                    href={action.href}
                    className="guide-btn"
                    aria-disabled={action.blocked ? "true" : undefined}
                    onClick={(event) => {
                        if (action.blocked) {
                            event.preventDefault();
                        }
                    }}
                >
                    {action.blocked ? action.disabledLabel : action.label}
                </a>
                <DemoOnly />
            </section>
        );
    }

    const transfer = transferByRole[currentRole];

    return (
        <section className="journey" aria-label="Guía de avance de la demo">
            <ol className="journey__list">
                {journeySteps.map((entry, index) => {
                    const statusClass =
                        index < step
                            ? "journey__step--done"
                            : index === step
                              ? "journey__step--current"
                              : "journey__step--future";

                    return (
                        <li
                            key={entry.title}
                            className={`journey__step ${statusClass}`}
                        >
                            {index < step ? (
                                <s>{entry.title}</s>
                            ) : (
                                <span>{entry.title}</span>
                            )}
                        </li>
                    );
                })}
            </ol>

            <p className="journey__transfer-text">
                Este paso lo hace {transfer.mention} · en la demo, ese
                {currentRole === "cliente" ? " barista" : " cliente"} eres tú
            </p>
            <button
                type="button"
                className="guide-btn guide-btn--ghost"
                onClick={() =>
                    currentRole === "cliente"
                        ? signInAs("brujula@punch.pe", "/cafe")
                        : signInAs("demo-consumer@punch.pe", "/home")
                }
            >
                Cambiar a {transfer.label}
            </button>
            <DemoOnly />
        </section>
    );
}
