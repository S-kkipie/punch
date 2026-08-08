import { LANDING_COPY } from "../landing-content";

export function OperatingTrust() {
    const { trust } = LANDING_COPY;

    return (
        <section
            aria-labelledby="operating-trust-title"
            className="pnch-section pnch-trust"
            id="el-modelo"
        >
            <div className="pnch-shell">
                <p className="pnch-eyebrow">{trust.eyebrow}</p>
                <h2 id="operating-trust-title">{trust.title}</h2>
                <p className="pnch-section__lede">{trust.body}</p>
                <div className="pnch-ledger">
                    <div className="pnch-ledger__column pnch-ledger__column--consumption">
                        <p className="pnch-ledger__label">Pago de consumo</p>
                        <span className="pnch-ledger__node">
                            Cliente paga al café
                        </span>
                    </div>
                    <div className="pnch-ledger__column pnch-ledger__column--network">
                        <p className="pnch-ledger__label">Beneficio de red</p>
                        <span className="pnch-ledger__node">
                            Reserva prefondada
                        </span>
                        <span aria-hidden="true" className="pnch-ledger__arrow">
                            ↓
                        </span>
                        <span className="pnch-ledger__node">
                            Estado verificable
                        </span>
                    </div>
                </div>
                <div className="pnch-trust__details">
                    <div className="pnch-trust__note pnch-trust__note--campaign">
                        <p className="pnch-panel-kicker">Campaña</p>
                        <p>Voucher con condiciones activas de la red.</p>
                    </div>
                    <div className="pnch-trust__note pnch-trust__note--punch">
                        <p className="pnch-panel-kicker">PUNCH</p>
                        <p>Registro de participación y estado verificable.</p>
                    </div>
                </div>
                <p className="pnch-trust__technical">{trust.technical}</p>
                <p className="pnch-note">
                    {trust.direct} {trust.invisible}
                </p>
            </div>
        </section>
    );
}
