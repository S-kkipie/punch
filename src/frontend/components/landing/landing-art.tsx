import Image from "next/image";

export function RouteLine({ label }: { label: string }) {
    return (
        <div aria-hidden="true" className="pnch-route">
            <span className="pnch-route__line" />
            <span className="pnch-route__label">{label}</span>
        </div>
    );
}

export function NetworkMap() {
    const cafes = ["Barranco", "Miraflores", "Surquillo"];

    return (
        <div
            aria-label="Tres cafeterías independientes conectadas por una ruta compartida"
            className="pnch-network-map"
            role="img"
        >
            <span aria-hidden="true" className="pnch-network-map__route" />
            {cafes.map((cafe, index) => (
                <span
                    aria-hidden="true"
                    className={`pnch-network-map__node pnch-network-map__node--${index + 1}`}
                    key={cafe}
                >
                    Café
                    <br />
                    {cafe}
                </span>
            ))}
        </div>
    );
}

export function CafeCustomerCollage() {
    return (
        <div
            aria-label="Una visita conectada entre una persona y una cafetería independiente"
            className="pnch-collage"
            role="img"
        >
            <figure className="pnch-photo pnch-photo--cafe">
                <Image
                    alt=""
                    fill
                    priority
                    sizes="(max-width: 767px) 88vw, 42vw"
                    src="/landing/cafe-interior.webp"
                />
            </figure>
            <figure className="pnch-photo pnch-photo--customer">
                <Image
                    alt=""
                    fill
                    priority
                    sizes="(max-width: 767px) 48vw, 20vw"
                    src="/landing/coffee-customer.webp"
                />
            </figure>
            <RouteLine label="VISITA → DESCUBRE → REGRESA" />
            <blockquote className="pnch-collage__quote">
                “Llegué por la red. Volví por el café.”
            </blockquote>
        </div>
    );
}
