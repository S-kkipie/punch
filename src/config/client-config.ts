import { env } from "./env";

export const ClientConfig = {
    baseUrl: env.NEXT_PUBLIC_APP_URL,
    demoMode: env.NEXT_PUBLIC_DEMO_MODE,
    demoPassword: env.NEXT_PUBLIC_DEMO_PASSWORD,
} as const;
