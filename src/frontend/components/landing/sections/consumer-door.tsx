import { LANDING_COPY, LANDING_LINKS } from "../landing-content";

export function ConsumerDoor() {
    const { consumer } = LANDING_COPY;

    return (
        <section
            aria-labelledby="consumer-door-title"
            className="pnch-section pnch-consumer-door"
            id="para-quienes-toman-cafe"
        >
            <div className="pnch-shell pnch-consumer-door__inner">
                <div>
                    <p className="pnch-eyebrow">{consumer.eyebrow}</p>
                    <h2 id="consumer-door-title">{consumer.title}</h2>
                </div>
                <div className="pnch-consumer-door__copy">
                    <p className="pnch-section__lede">{consumer.body}</p>
                    <a
                        className="pnch-cta pnch-cta--text"
                        href={LANDING_LINKS.consumer}
                    >
                        {consumer.cta} →
                    </a>
                </div>
            </div>
        </section>
    );
}
