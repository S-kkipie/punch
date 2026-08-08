import type { CSSProperties } from "react";
import { LandingNav } from "./landing-nav";
import "./landing.css";

/** Stagger a section into the single page-load entrance. */
const step = (i: number) => ({ "--i": i }) as CSSProperties;

/**
 * The hero's proof half — a punch card built in pure CSS (Tier A).
 * Ten holes: eight taps at 120 puntos each, the eighth landing once on
 * load. The numbers are the spec's own: 1 punto = S/0.01, tasa 10 %,
 * 1,200 puntos = S/12 = un cortado.
 */
function PunchCard() {
    return (
        <div className="pnch-card">
            <div className="pnch-card__head">
                <h2 className="pnch-card__name">Café La Quinta</h2>
                <span className="pnch-card__streak">Racha · día 7</span>
            </div>

            <ul
                aria-label="8 de 10 cafés registrados en esta tarjeta"
                className="pnch-card__holes"
                role="img"
            >
                {Array.from({ length: 10 }, (_, i) => {
                    const done = i < 7;
                    const fresh = i === 7;
                    return (
                        <li
                            className={[
                                "pnch-card__hole",
                                done ? "pnch-card__hole--done" : "",
                                fresh ? "pnch-card__hole--fresh" : "",
                            ]
                                .filter(Boolean)
                                .join(" ")}
                            key={`hole-${i}`}
                        />
                    );
                })}
            </ul>

            <div className="pnch-card__foot">
                <span className="pnch-card__figure">960 / 1,200 puntos</span>
                <span className="pnch-card__hint">
                    Faltan 2 · el cortado va libre
                </span>
            </div>
        </div>
    );
}

export function PunchLanding() {
    return (
        <div className="pnch" id="top">
            <LandingNav />

            <main>
                {/* Hero · H2 split diptych — claim left, proof right. */}
                <section className="pnch-hero">
                    <div className="pnch-shell">
                        <div className="pnch-hero__grid">
                            <div className="pnch-reveal" style={step(0)}>
                                <h1 className="pnch-hero__title">
                                    Tu tarjeta de sellos, pero vale en toda la
                                    ciudad.
                                </h1>
                                <p className="pnch-lede pnch-hero__lede">
                                    Escaneas el QR del mostrador y sumas puntos.
                                    Los gastas en cualquier cafetería de la red,
                                    no solo en la que te los dio. Un punto vale
                                    un céntimo y está respaldado con plata ya
                                    depositada.
                                </p>
                                <div className="pnch-hero__actions">
                                    <a
                                        className="pnch-cta pnch-cta--fill"
                                        href="/auth/sign-up"
                                    >
                                        Soy cliente →
                                    </a>
                                    <a
                                        className="pnch-cta"
                                        href="/auth/sign-up?rol=cafe"
                                    >
                                        Tengo un café →
                                    </a>
                                </div>
                            </div>

                            <div
                                className="pnch-reveal pnch-split__aside"
                                style={step(1)}
                            >
                                <PunchCard />
                            </div>
                        </div>

                        {/* T4 · stat strip. Facts fixed in the contract, not traction. */}
                        <div className="pnch-facts pnch-reveal" style={step(2)}>
                            <div className="pnch-fact">
                                <b>1 punto</b>
                                <span>
                                    S/0.01, fijo. No lo fijamos nosotros.
                                </span>
                            </div>
                            <div className="pnch-fact">
                                <b>10 cafés</b>
                                <span>1,200 puntos = S/12 = un cortado.</span>
                            </div>
                            <div className="pnch-fact">
                                <b>0 %</b>
                                <span>Comisión de canje. A propósito.</span>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="pnch-shell">
                    <hr className="pnch-perf" />
                </div>

                {/* El problema — prose left, the acquisition ledger right. */}
                <section className="pnch-shell">
                    <div className="pnch-head">
                        <h2>Seis cartones a medio llenar.</h2>
                    </div>

                    <div className="pnch-split">
                        <div>
                            <p className="pnch-prose">
                                Cada cartón vale en un solo local, así que nunca
                                completas ninguno. Y el café no sabe nada de ti
                                más allá de los sellos que él mismo puso.
                            </p>
                            <p className="pnch-prose">
                                Del otro lado del mostrador el problema es peor.
                                Una cafetería que abre hoy tiene tres canales
                                para conseguir clientes, y ninguno le deja pedir
                                lo único que le importa:{" "}
                                <span className="pnch-mark">
                                    la gente que ya toma quince cafés al mes a
                                    trescientos metros y nunca entró acá.
                                </span>
                            </p>
                        </div>

                        <div className="pnch-split__aside">
                            <table className="pnch-spec">
                                <caption>
                                    Esa persona existe, está a 300 metros, y hoy
                                    es invisible.
                                </caption>
                                <thead>
                                    <tr>
                                        <th scope="col">Canal</th>
                                        <th scope="col">Costo</th>
                                        <th scope="col">Qué compra</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <th scope="row">Volanteo</th>
                                        <td className="pnch-spec__val">
                                            S/0.10 c/u
                                        </td>
                                        <td>Impresiones. Cero atribución.</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Instagram Ads</th>
                                        <td className="pnch-spec__val">
                                            S/20–40 CAC
                                        </td>
                                        <td>
                                            Un click. No sabe si tomas café.
                                        </td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Boca a boca</th>
                                        <td className="pnch-spec__val">
                                            Gratis
                                        </td>
                                        <td>No se puede acelerar.</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>
                    </div>
                </section>

                <div className="pnch-shell">
                    <hr className="pnch-perf" />
                </div>

                {/* Cómo funciona · F4 step sequence — genuinely ordinal. */}
                <section className="pnch-shell" id="como-funciona">
                    <div className="pnch-head">
                        <h2>Un tap en el mostrador.</h2>
                        <p className="pnch-prose">
                            Nunca ves una wallet. Nunca pagas gas. Nunca lees la
                            palabra «blockchain».
                        </p>
                    </div>

                    <ol className="pnch-steps">
                        <li className="pnch-step">
                            <span className="pnch-step__stage">1.0</span>
                            <h3>En el mostrador.</h3>
                            <p>
                                El barista marca S/12 en su panel. La pantalla
                                muestra un QR firmado por el café: monto, nonce,
                                expiración.
                            </p>
                        </li>
                        <li className="pnch-step">
                            <span className="pnch-step__stage">2.0</span>
                            <h3>El tap.</h3>
                            <p>
                                Escaneas y tu wallet firma. Las dos firmas
                                viajan juntas — eso es el proof de consumo.
                                Nuestro servidor relaya la transacción y paga el
                                gas.
                            </p>
                        </li>
                        <li className="pnch-step">
                            <span className="pnch-step__stage">3.0</span>
                            <h3>El canje.</h3>
                            <p>
                                +120 puntos. A los 1,200 pides tu cortado en
                                cualquier café de la red, y ese local cobra los
                                S/12 completos del pool, al instante.
                            </p>
                        </li>
                    </ol>
                </section>

                <div className="pnch-shell">
                    <hr className="pnch-perf" />
                </div>

                {/* The thesis diptych — the split IS the product decision. */}
                <section className="pnch-shell">
                    <div className="pnch-head">
                        <h2 className="pnch-thesis">
                            Ganas más donde eres fiel. Gastas donde quieras.
                        </h2>
                    </div>

                    <div className="pnch-split">
                        <div className="pnch-half">
                            <span className="pnch-half__label">
                                Lealtad · vive en la emisión
                            </span>
                            <h3>Cada café escribe sus propias reglas.</h3>
                            <p>
                                Racha de siete días, 2×. Martes, 1.5×. El flat
                                white de la casa, 3×. El local decide dónde
                                premia y cuánto, y esa decisión no sale de un
                                panel nuestro.
                            </p>
                        </div>

                        <div className="pnch-half pnch-split__aside">
                            <span className="pnch-half__label">
                                Portabilidad · vive en el canje
                            </span>
                            <h3>Un punto es un céntimo, en toda la red.</h3>
                            <p>
                                Sin castigo por canjear afuera, sin letra chica,
                                sin fecha de vencimiento. Es la parte que un
                                cartón de sellos no puede prometer.
                            </p>
                        </div>
                    </div>
                </section>

                <div className="pnch-shell">
                    <hr className="pnch-perf" />
                </div>

                {/* Prefondeado — prose left, ledger diagram right (flipped row). */}
                <section className="pnch-shell">
                    <div className="pnch-head">
                        <h2>Tus puntos no son una promesa.</h2>
                    </div>

                    <div className="pnch-split pnch-split--flip">
                        <div>
                            <p className="pnch-prose">
                                Un programa de puntos normal es deuda no
                                fondeada: quien los emitió puede devaluarlos
                                cuando quiera. Es exactamente lo que hacen las
                                aerolíneas con las millas, y el consumidor no
                                tiene forma de verificar el respaldo porque no
                                existe.
                            </p>
                            <p className="pnch-prose">
                                Acá el café deposita antes de emitir. Cuando
                                canjeas en otro local, ese local cobra del pool
                                y no le reclama nada a nadie. Cero riesgo de
                                contraparte, cero cobranza, nada que arbitrar.
                            </p>
                            <p className="pnch-note pnch-note--spaced">
                                El colateral, el peg y las condiciones de
                                campaña están en el contrato. Si PUNCH
                                desaparece mañana, los cafés recuperan su
                                colateral y los usuarios canjean sus puntos.
                            </p>
                        </div>

                        <div className="pnch-split__aside">
                            <div className="pnch-ledger">
                                <div className="pnch-ledger__col">
                                    <span className="pnch-ledger__title">
                                        Otros diseños · deuda
                                    </span>
                                    <ul className="pnch-ledger__list">
                                        <li>A emite → usuario</li>
                                        <li>B le reclama a A</li>
                                        <li>¿y si A no paga?</li>
                                    </ul>
                                </div>
                                <div className="pnch-ledger__col pnch-ledger__col--ours">
                                    <span className="pnch-ledger__title">
                                        PUNCH · prefondeado
                                    </span>
                                    <ul className="pnch-ledger__list">
                                        <li>A deposita → pool</li>
                                        <li>B cobra del pool</li>
                                        <li>ya estaba pagado</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="pnch-shell">
                    <hr className="pnch-perf" />
                </div>

                {/* Para tu café — campaign card left, argument right. */}
                <section className="pnch-shell" id="para-tu-cafe">
                    <div className="pnch-head">
                        <h2>Compra clientes verificados, no impresiones.</h2>
                    </div>

                    <div className="pnch-split">
                        <div className="pnch-campaign">
                            <span className="pnch-campaign__title">
                                Campaña — adquisición
                            </span>
                            <dl>
                                <dt>Segmento</dt>
                                <dd>
                                    Coffee Score &gt; 500 · nunca hizo tap acá
                                </dd>
                                <dt>Radio</dt>
                                <dd>2 km</dd>
                                <dt>Ventana</dt>
                                <dd>L–V, 14:00–17:00</dd>
                                <dt>Reward</dt>
                                <dd>S/5 en puntos, al primer consumo</dd>
                                <dt>Presupuesto</dt>
                                <dd>S/500</dd>
                            </dl>
                            <span className="pnch-campaign__out">
                                → 100 conversiones máximo, pagadas por el
                                contrato
                            </span>
                        </div>

                        <div className="pnch-split__aside">
                            <p className="pnch-prose">
                                El contrato retiene los S/500. Alguien que
                                califica recibe la oferta, camina, hace tap — y
                                el contrato le paga solo. El café no aprueba
                                nada. Nosotros tampoco.
                            </p>
                            <p className="pnch-prose">
                                <span className="pnch-mark">
                                    Pagas por consumo. No por impresión, no por
                                    click.
                                </span>
                            </p>

                            <div className="pnch-yield">
                                <h3>
                                    La franja horaria no es un filtro, es el
                                    modelo.
                                </h3>
                                <p>
                                    Un cortado a las 9 a. m., con el local
                                    lleno, desplaza a un cliente que dejaba más.
                                    El mismo cortado a las 3 p. m. es una mesa
                                    muerta que se llenó. El café no regala
                                    margen: vende inventario que se le vencía.
                                </p>
                            </div>
                        </div>
                    </div>
                </section>

                <div className="pnch-shell">
                    <hr className="pnch-perf" />
                </div>

                {/* El modelo · F3 spec sheet. */}
                <section className="pnch-shell" id="el-modelo">
                    <div className="pnch-head">
                        <h2>Cobramos el mercado, no la herramienta.</h2>
                    </div>

                    <div className="pnch-split">
                        <div>
                            <table className="pnch-spec">
                                <caption>
                                    Arbitrum es infraestructura, no es el modelo
                                    de negocio. Sin token especulativo.
                                </caption>
                                <thead>
                                    <tr>
                                        <th scope="col">Fuente</th>
                                        <th scope="col">Cuánto</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr>
                                        <th scope="row">Campaign fee</th>
                                        <td className="pnch-spec__val">
                                            10–15 %
                                        </td>
                                    </tr>
                                    <tr>
                                        <th scope="row">
                                            Lealtad, red, CRM y analytics
                                        </th>
                                        <td className="pnch-spec__val">S/0</td>
                                    </tr>
                                    <tr>
                                        <th scope="row">Comisión de canje</th>
                                        <td className="pnch-spec__val">0 %</td>
                                    </tr>
                                </tbody>
                            </table>
                        </div>

                        <div className="pnch-split__aside">
                            <p className="pnch-prose">
                                Digitalizar el cartón de sellos es lo que otros
                                venden por suscripción mensual. Acá es gratis
                                para siempre, porque el ingreso está en el
                                mercado que esa herramienta crea: los cafés
                                compitiendo, en abierto, por un cliente que ya
                                toma café todos los días.
                            </p>
                            <p className="pnch-prose">
                                El enemigo de una cafetería independiente no es
                                la cafetería de la esquina. Solo, ningún
                                independiente puede tener el programa de lealtad
                                de Starbucks.{" "}
                                <span className="pnch-mark">
                                    Juntos, todos lo tienen.
                                </span>
                            </p>
                        </div>
                    </div>
                </section>

                <div className="pnch-shell">
                    <hr className="pnch-perf" />
                </div>

                {/* Two doors — the page's action, restated as the diptych. */}
                <section className="pnch-shell">
                    <div className="pnch-doors">
                        <div className="pnch-door">
                            <h2>Tomas café todos los días.</h2>
                            <p>
                                Empieza a acumular en el próximo tap. Sin
                                instalar nada, sin wallet, sin gas.
                            </p>
                            <a
                                className="pnch-cta pnch-cta--fill"
                                href="/auth/sign-up"
                            >
                                Soy cliente →
                            </a>
                        </div>

                        <div className="pnch-door pnch-split__aside">
                            <h2>Tienes una cafetería.</h2>
                            <p>
                                Wallet, nombre, geo y tu QR. Te registras solo,
                                sin comercial y sin pedirnos permiso.
                            </p>
                            <a
                                className="pnch-cta"
                                href="/auth/sign-up?rol=cafe"
                            >
                                Tengo un café →
                            </a>
                        </div>
                    </div>
                </section>
            </main>

            {/* Ft4 · dense colophon. The disclosures live where a colophon lives. */}
            <footer className="pnch-colophon">
                <div className="pnch-shell">
                    <span aria-hidden="true" className="pnch-colophon__mark">
                        <span>P</span>
                        <span className="pnch-nav__brand-hole" />
                        <span>NCH</span>
                    </span>

                    <p>
                        PUNCH — red abierta de consumo, lealtad y adquisición
                        para cafeterías. Hackathon Ethereum Lima 2026, Arbitrum
                        Track. Desplegado en Arbitrum Sepolia. Mercado inicial:
                        Arequipa, Perú. Un punto equivale a S/0.01, fijo,
                        respaldado 1:1 por dinero depositado en el contrato.
                    </p>
                    <p>
                        Dos límites que se dicen en voz alta, no se esconden: en
                        testnet el dinero es mPEN, un ERC-20 de prueba con
                        faucet — soles simulados, no soles; y el MVP usa wallet
                        custodial, con la firma del consumidor producida por
                        nuestro servidor. La red del demo es data sembrada, no
                        tracción real. Sin token especulativo.
                    </p>
                    <p>
                        Contratos: CafeRegistry · ConsumptionLog · RewardVault ·
                        CampaignEscrow · MockPEN. Direcciones y enlaces a
                        Arbiscan: pendiente. Tipografía: Fraunces, IBM Plex Sans
                        y JetBrains Mono.
                    </p>
                </div>
            </footer>
        </div>
    );
}
