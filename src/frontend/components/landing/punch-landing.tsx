import { LandingNav } from "./landing-nav";
import { HeroNetwork } from "./sections/hero-network";
import "./landing.css";

export function PunchLanding() {
    return (
        <div className="pnch" id="top">
            <LandingNav />
            <main>
                <HeroNetwork />
            </main>
        </div>
    );
}
