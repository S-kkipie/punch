import { LANDING_COPY, LANDING_LINKS } from "../landing-content";

export function DualCTA() {
    const { finalCta } = LANDING_COPY;

    return (
        <section aria-labelledby="final-cta-title" className="pnch-dual-cta">
            <div className="pnch-shell pnch-dual-cta__grid">
                <div className="pnch-dual-cta__cafe">
                    <p className="pnch-audience-label">Para tu café</p>
                    <h2 id="final-cta-title">{finalCta.cafeTitle}</h2>
                    <p>{finalCta.cafeBody}</p>
                    <a
                        className="pnch-cta pnch-cta--fill"
                        href={LANDING_LINKS.cafe}
                    >
                        {finalCta.cafeCta} →
                    </a>
                </div>
                <div className="pnch-dual-cta__consumer">
                    <p className="pnch-audience-label">
                        Para quienes toman café
                    </p>
                    <h2>{finalCta.consumerTitle}</h2>
                    <p>{finalCta.consumerBody}</p>
                    <a
                        className="pnch-cta pnch-cta--text"
                        href={LANDING_LINKS.consumer}
                    >
                        {finalCta.consumerCta} →
                    </a>
                </div>
            </div>
        </section>
    );
}
