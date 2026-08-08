import { LANDING_COPY, LANDING_LINKS } from "../landing-content";
import { CafeCustomerCollage } from "../landing-art";

export function HeroNetwork() {
    const copy = LANDING_COPY.hero;

    return (
        <section aria-labelledby="hero-title" className="pnch-hero">
            <div className="pnch-shell pnch-hero__grid">
                <div className="pnch-hero__copy">
                    <p className="pnch-eyebrow">{copy.eyebrow}</p>
                    <h1 id="hero-title">{copy.title}</h1>
                    <p className="pnch-lede">{copy.body}</p>
                    <div className="pnch-actions">
                        <a className="pnch-cta pnch-cta--fill" href={LANDING_LINKS.cafe}>
                            {copy.primaryCta} →
                        </a>
                        <a className="pnch-cta pnch-cta--text" href={LANDING_LINKS.consumer}>
                            {copy.secondaryCta} →
                        </a>
                    </div>
                </div>
                <CafeCustomerCollage />
            </div>
        </section>
    );
}
