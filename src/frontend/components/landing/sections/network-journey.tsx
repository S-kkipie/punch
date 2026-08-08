import { NetworkMap } from "../landing-art";
import { LANDING_COPY } from "../landing-content";

export function NetworkJourney() {
    const { journey } = LANDING_COPY;

    return (
        <section
            aria-labelledby="journey-title"
            className="pnch-section pnch-journey"
            id="red-en-movimiento"
        >
            <div className="pnch-shell pnch-journey__grid">
                <div>
                    <p className="pnch-eyebrow">{journey.eyebrow}</p>
                    <h2 id="journey-title">{journey.title}</h2>
                    <p className="pnch-route-label">
                        VISITA → DESCUBRE → REGRESA
                    </p>
                </div>
                <NetworkMap />
                <ul className="pnch-outcomes">
                    {journey.outcomes.map((outcome) => (
                        <li key={outcome.title}>
                            <h3>{outcome.title}</h3>
                            <p>{outcome.body}</p>
                        </li>
                    ))}
                </ul>
            </div>
        </section>
    );
}
