import { LandingNav } from "./landing-nav";
import "./landing.css";
import { CafeValue } from "./sections/cafe-value";
import { HeroNetwork } from "./sections/hero-network";
import { NetworkJourney } from "./sections/network-journey";
import { OperatingTrust } from "./sections/operating-trust";
import { PunchSolution } from "./sections/punch-solution";
import { StructuralProblem } from "./sections/structural-problem";

export function PunchLanding() {
    return (
        <div className="pnch" id="top">
            <LandingNav />
            <main>
                <HeroNetwork />
                <StructuralProblem />
                <PunchSolution />
                <NetworkJourney />
                <CafeValue />
                <OperatingTrust />
            </main>
        </div>
    );
}
