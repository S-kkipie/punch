export const LANDING_LINKS = {
    cafe: "/auth/sign-up?rol=cafe",
    consumer: "/auth/sign-up",
    signIn: "/auth/sign-in",
} as const;

export const LANDING_COPY = {
    nav: {
        how: "Cómo funciona",
        cafe: "Para tu café",
        model: "Modelo",
        primaryCta: "Sumar mi café",
    },
    hero: {
        eyebrow: "Red de cafeterías independientes · Lima",
        title: "No necesitas parecer cadena. Necesitas mover clientes como una.",
        body: "PUNCH conecta visitas entre cafés independientes. Cada local conserva su identidad; toda la red gana alcance.",
        primaryCta: "Quiero sumar mi café",
        secondaryCta: "Explorar la red",
        route: "VISITA → DESCUBRE → REGRESA",
        quote: "Llegué por la red. Volví por el café.",
    },
    problem: {
        eyebrow: "El problema",
        title: "La calidad no compensa competir solo.",
        body: "Una cadena coordina alcance y retorno entre muchas puertas. Un café independiente suele pagar adquisición, construir lealtad y aprender de cada visita por su cuenta.",
        isolatedTitle: "Cada café por su cuenta",
        isolatedBody: "Adquisición aislada. Lealtad encerrada. Menor alcance.",
        networkTitle: "Una red compartida",
        networkBody: "Demanda colectiva. Retornos medibles. Identidad propia.",
    },
    solution: {
        eyebrow: "Cómo funciona",
        title: "La red trae la visita. Tu café hace que vuelva.",
        steps: [
            {
                title: "Descubre",
                body: "La red conecta al cliente con una cafetería independiente que todavía no conoce.",
            },
            {
                title: "Visita",
                body: "El cliente paga directo al café. PUNCH registra una participación elegible sin intermediar la venta.",
            },
            {
                title: "Regresa",
                body: "Los beneficios activos ayudan a convertir una visita aislada en una relación con toda la red.",
            },
        ],
        conditions:
            "Cada campaña define sus condiciones activas. El umbral no es la promesa de PUNCH; la red sí.",
    },
    journey: {
        eyebrow: "Red en movimiento",
        title: "Más puertas para descubrir. Más razones para regresar.",
        outcomes: [
            {
                title: "Más alcance",
                body: "La coalición crea oportunidades que un local aislado no puede crear solo.",
            },
            {
                title: "Visitas pagadas",
                body: "El valor aparece cuando una persona entra y compra, no cuando ve un anuncio.",
            },
            {
                title: "Retornos medibles",
                body: "La relación continúa dentro de una red, no en una tarjeta olvidada.",
            },
        ],
    },
    cafeValue: {
        eyebrow: "Para tu café",
        title: "Comparte demanda. Conserva lo que te hace independiente.",
        benefits: [
            "Tu marca y experiencia siguen siendo tuyas.",
            "El cliente te paga directamente por Yape.",
            "La red amplía tu alcance y hace visible el retorno.",
            "La reserva protege el cumplimiento de beneficios activos.",
        ],
        planLabel: "Plan de red",
        planPrice: "S/49 al mes",
        planBody:
            "Incluye reserva de recompensas, aporte al fondo común y créditos de emisión según la configuración vigente.",
        cta: "Quiero sumar mi café",
    },
    trust: {
        eyebrow: "Confianza operativa",
        title: "Primero respaldo. Después beneficio.",
        body: "PUNCH usa reservas prefondadas y estados verificables para que la red no dependa de promesas informales entre cafés.",
        direct: "El pago de consumo va del cliente al café.",
        invisible:
            "El consumidor no necesita wallet, gas ni conocimiento de blockchain.",
        technical: "Arbitrum manda. Postgres proyecta.",
    },
    consumer: {
        eyebrow: "Para quienes toman café",
        title: "Tu próxima cafetería favorita puede estar a pocas cuadras.",
        body: "Descubre cafés independientes y participa en beneficios activos de toda la red, sin tratar PUNCH como dinero ni activo financiero.",
        cta: "Quiero descubrir la red",
    },
    finalCta: {
        cafeTitle:
            "Tu café puede seguir siendo independiente sin competir solo.",
        cafeBody:
            "Súmate a una red diseñada para mover demanda entre cafeterías independientes.",
        cafeCta: "Quiero sumar mi café",
        consumerTitle: "¿Buscas mejor café, no otra cadena?",
        consumerBody: "Explora una red de lugares con identidad propia.",
        consumerCta: "Quiero descubrir la red",
    },
    footer: {
        summary:
            "PUNCH — red de demanda y lealtad para cafeterías independientes.",
        market: "Mercado inicial: Lima, Perú.",
        demo: "Demo en Arbitrum Sepolia. Los fondos y la actividad del demo son simulados; no representan tracción real.",
        conditions:
            "Las condiciones de campaña, emisión y canje pueden variar según la configuración activa de la red.",
        contracts:
            "CafeRegistry · PlanManager · ConsumptionLog · PunchVault · CampaignEscrow · MockPEN",
    },
} as const;

export type LandingLink = keyof typeof LANDING_LINKS;
export type LandingCopy = typeof LANDING_COPY;
