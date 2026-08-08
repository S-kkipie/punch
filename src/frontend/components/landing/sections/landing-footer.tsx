import { LANDING_COPY, LANDING_LINKS } from "../landing-content";

export function LandingFooter() {
    const { footer } = LANDING_COPY;

    return (
        <footer className="pnch-footer">
            <div className="pnch-shell pnch-footer__grid">
                <p className="pnch-footer__summary">{footer.summary}</p>
                <div className="pnch-footer__details">
                    <p>{footer.market}</p>
                    <p>{footer.demo}</p>
                    <p>{footer.conditions}</p>
                    <p className="pnch-footer__contracts">{footer.contracts}</p>
                    <a href={LANDING_LINKS.signIn}>Entrar</a>
                </div>
            </div>
        </footer>
    );
}
