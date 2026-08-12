import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    serverExternalPackages: ["pg"],
    env: {
        /**
         * El cliente decide con esto si muestra el hash como enlace a Arbiscan
         * o como texto de cadena local. Si el despliegue solo define `CHAIN_ENV`
         * —la variable que ya necesita el servidor— se hereda de ahí: sin este
         * respaldo, producción escribía en Arbitrum Sepolia pero la pantalla
         * decía "cadena local de desarrollo" y no ofrecía el enlace.
         */
        NEXT_PUBLIC_CHAIN_ENV:
            process.env.NEXT_PUBLIC_CHAIN_ENV ??
            process.env.CHAIN_ENV ??
            "local",
    },
};

export default nextConfig;
