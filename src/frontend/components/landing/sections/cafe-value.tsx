import { LANDING_COPY, LANDING_LINKS } from "../landing-content";

export function CafeValue() {
    const { cafeValue } = LANDING_COPY;

    return (
        <section
            aria-labelledby="cafe-value-title"
            className="pnch-section pnch-cafe-value"
            id="para-tu-cafe"
        >
            <div className="pnch-shell">
                <div className="pnch-cafe-value__intro">
                    <h2 id="cafe-value-title">{cafeValue.title}</h2>
                    <ul className="pnch-cafe-value__benefits">
                        {cafeValue.benefits.map((benefit) => (
                            <li key={benefit}>{benefit}</li>
                        ))}
                    </ul>
                </div>
                <div className="pnch-plan-slip">
                    <p className="pnch-panel-kicker">{cafeValue.planLabel}</p>
                    <p className="pnch-plan-slip__price">
                        {cafeValue.planPrice}
                    </p>
                    <p className="pnch-plan-slip__body">{cafeValue.planBody}</p>
                    <a
                        className="pnch-cta pnch-cta--fill"
                        href={LANDING_LINKS.cafe}
                    >
                        {cafeValue.cta}
                    </a>
                </div>
            </div>
        </section>
    );
}
