import { LANDING_COPY } from "../landing-content";

export function PunchSolution() {
    const { solution } = LANDING_COPY;

    return (
        <section
            aria-labelledby="solution-title"
            className="pnch-section pnch-solution"
            id="como-funciona"
        >
            <div className="pnch-shell">
                <h2 id="solution-title">{solution.title}</h2>
                <ol className="pnch-solution__steps">
                    {solution.steps.map((step, index) => (
                        <li className="pnch-solution__step" key={step.title}>
                            <span
                                aria-hidden="true"
                                className="pnch-solution__number"
                            >
                                0{index + 1}
                            </span>
                            <div>
                                <h3>{step.title}</h3>
                                <p>{step.body}</p>
                            </div>
                        </li>
                    ))}
                </ol>
                <p className="pnch-note">{solution.conditions}</p>
            </div>
        </section>
    );
}
