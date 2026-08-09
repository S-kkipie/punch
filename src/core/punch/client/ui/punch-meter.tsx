import { progressFraction } from "@/core/punch/domain/progress";

export function punchMeterLabel(balance: number): string {
    const { numerator, denominator } = progressFraction(balance);
    return numerator >= denominator
        ? `${numerator} / ${denominator} — Recompensa disponible`
        : `${numerator} / ${denominator}`;
}

export function PunchMeter({ balance }: { balance: number }) {
    const { numerator, denominator } = progressFraction(balance);
    const percentage = (numerator / denominator) * 100;

    return (
        <section
            className="consumer-panel punch-meter"
            aria-labelledby="punch-meter-title"
        >
            <div className="punch-meter__heading">
                <span className="consumer-eyebrow">Tu recorrido</span>
                <h2 id="punch-meter-title" className="consumer-title">
                    PUNCH que vuelve al barrio
                </h2>
            </div>
            <div className="punch-meter__row">
                <div className="punch-meter__track">
                    <meter
                        className="punch-meter__native"
                        aria-label="Progreso hacia la recompensa"
                        min={0}
                        max={denominator}
                        value={numerator}
                    />
                    <div
                        className="punch-meter__fill"
                        style={{ width: `${percentage}%` }}
                        aria-hidden="true"
                    />
                    <span className="punch-meter__value">
                        {numerator}
                        <small>/{denominator}</small>
                    </span>
                </div>
                <p className="punch-meter__message">
                    {punchMeterLabel(balance)}
                </p>
            </div>
            <p className="punch-meter__note">
                Cada compra en una cafetería aliada suma un PUNCH. Al llegar a
                12, tienes una recompensa para disfrutar en la red.
            </p>
        </section>
    );
}
