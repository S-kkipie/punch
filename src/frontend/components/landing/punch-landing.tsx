import { LandingNav } from "./landing-nav";
import "./landing.css";
import { CafeValue } from "./sections/cafe-value";
import { ConsumerDoor } from "./sections/consumer-door";
import { DualCTA } from "./sections/dual-cta";
import { HeroNetwork } from "./sections/hero-network";
import { LandingFooter } from "./sections/landing-footer";
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
                <ConsumerDoor />
                <DualCTA />
            </main>
            <LandingFooter />
        </div>
    );
}
