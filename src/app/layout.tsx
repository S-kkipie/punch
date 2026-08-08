import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";
import type { PropsWithChildren } from "react";
import { Providers } from "@/frontend/providers/providers";
import { PwaRegister } from "./pwa-register";
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
    title: "PUNCH — una red de cafeterías independientes",
    description:
        "PUNCH conecta cafeterías independientes para compartir demanda, atraer visitas y generar retornos medibles sin perder su identidad.",
    manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
    themeColor: "#2b2520",
};

export default function RootLayout({ children }: PropsWithChildren) {
    return (
        <html
            className={`${fraunces.variable} ${plexSans.variable} ${jetbrainsMono.variable}`}
            lang="es"
            suppressHydrationWarning
        >
            <body className="min-h-svh antialiased">
                <PwaRegister />
                <Providers>{children}</Providers>
            </body>
        </html>
    );
}
