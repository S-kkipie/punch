import { LANDING_COPY, LANDING_LINKS } from "../landing-content";

export function DualCTA() {
    const { finalCta } = LANDING_COPY;

    return (
        <section aria-labelledby="final-cta-heading" className="pnch-dual-cta">
            <div className="pnch-shell pnch-dual-cta__grid">
                <h2 className="pnch-sr-only" id="final-cta-heading">
                    Elige cómo participar en PUNCH: suma tu café o descubre la
                    red
                </h2>
                <article
                    aria-labelledby="final-cta-cafe-title"
                    className="pnch-dual-cta__cafe"
                >
                    <p className="pnch-audience-label">Para tu café</p>
                    <h3 id="final-cta-cafe-title">{finalCta.cafeTitle}</h3>
                    <p>{finalCta.cafeBody}</p>
                    <a
                        className="pnch-cta pnch-cta--fill"
                        href={LANDING_LINKS.cafe}
                    >
                        {finalCta.cafeCta} →
                    </a>
                </article>
                <article
                    aria-labelledby="final-cta-consumer-title"
                    className="pnch-dual-cta__consumer"
                >
                    <p className="pnch-audience-label">
                        Para quienes toman café
                    </p>
                    <h3 id="final-cta-consumer-title">
                        {finalCta.consumerTitle}
                    </h3>
                    <p>{finalCta.consumerBody}</p>
                    <a
                        className="pnch-cta pnch-cta--text"
                        href={LANDING_LINKS.consumer}
                    >
                        {finalCta.consumerCta} →
                    </a>
                </article>
            </div>
        </section>
    );
}
