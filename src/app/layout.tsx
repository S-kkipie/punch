import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import type { PropsWithChildren } from "react";
import { Providers } from "@/frontend/providers/providers";
import "./globals.css";

const fraunces = Fraunces({
    subsets: ["latin"],
    display: "swap",
    variable: "--font-fraunces",
});

const plexSans = IBM_Plex_Sans({
    subsets: ["latin"],
    display: "swap",
    weight: ["400", "600"],
    variable: "--font-plex-sans",
});

const jetbrainsMono = JetBrains_Mono({
    subsets: ["latin"],
    display: "swap",
    variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
    title: "PUNCH — tu tarjeta de sellos, pero vale en toda la ciudad",
    description:
        "Red abierta de consumo, lealtad y adquisición para cafeterías. Sumas puntos en cualquier café de la red y los gastas en cualquier otro. Un punto vale S/0.01, respaldado 1:1 en un contrato sobre Arbitrum.",
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
};

export default function RootLayout({ children }: PropsWithChildren) {
    return (
        <html
            className={`${fraunces.variable} ${plexSans.variable} ${jetbrainsMono.variable}`}
            lang="es"
            suppressHydrationWarning
        >
            <body className="min-h-svh antialiased">
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
