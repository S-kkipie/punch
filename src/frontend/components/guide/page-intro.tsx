/**
 * Encabezado único de página. La línea `explain` traduce el concepto del
 * dominio a lenguaje humano: es obligatoria en toda página que nombre un
 * concepto propio de PUNCH (sello, fondo común, ruta, campaña).
 */
export function PageIntro({
    eyebrow,
    title,
    explain,
}: {
    eyebrow?: string;
    title: string;
    explain?: string;
}) {
    return (
        <div className="page-intro">
            {eyebrow ? (
                <span className="consumer-eyebrow">{eyebrow}</span>
            ) : null}
            <h1 className="consumer-title page-intro__title">{title}</h1>
            {explain ? <p className="page-intro__explain">{explain}</p> : null}
        </div>
    );
}
