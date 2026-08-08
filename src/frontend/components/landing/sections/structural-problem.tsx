import { LANDING_COPY } from "../landing-content";

const cafes = ["Barranco", "Miraflores", "Surquillo"];

function CafeStamps({ connected }: { connected: boolean }) {
    return (
        <div
            aria-hidden="true"
            className={`pnch-stamps${connected ? " pnch-stamps--connected" : ""}`}
        >
            {cafes.map((cafe, index) => (
                <span className="pnch-stamp" key={cafe}>
                    <span className="pnch-stamp__mark">P</span>
                    <span>{cafe}</span>
                    {connected && index < cafes.length - 1 ? (
                        <span className="pnch-stamp__route" />
                    ) : null}
                </span>
            ))}
        </div>
    );
}

export function StructuralProblem() {
    const { problem } = LANDING_COPY;

    return (
        <section
            aria-labelledby="problem-title"
            className="pnch-section pnch-problem"
        >
            <div className="pnch-shell">
                <p className="pnch-eyebrow">{problem.eyebrow}</p>
                <h2 id="problem-title">{problem.title}</h2>
                <p className="pnch-section__lede">{problem.body}</p>
                <div className="pnch-diptych">
                    <article className="pnch-diptych__panel pnch-diptych__panel--isolated">
                        <p className="pnch-panel-kicker">01 · Aislado</p>
                        <h3>{problem.isolatedTitle}</h3>
                        <CafeStamps connected={false} />
                        <p>{problem.isolatedBody}</p>
                    </article>
                    <article className="pnch-diptych__panel pnch-diptych__panel--network">
                        <p className="pnch-panel-kicker">02 · En coalición</p>
                        <h3>{problem.networkTitle}</h3>
                        <CafeStamps connected />
                        <p>{problem.networkBody}</p>
                    </article>
                </div>
            </div>
        </section>
    );
}
