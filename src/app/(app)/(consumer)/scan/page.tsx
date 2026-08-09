"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/frontend/components/ui/button";
import { Input } from "@/frontend/components/ui/input";

function extractProofId(value: string): string | undefined {
    const proofId = value.trim().split("/purchase/").pop();
    return proofId || undefined;
}

export default function ScanPage() {
    const router = useRouter();
    const routerRef = useRef(router);
    routerRef.current = router;
    const videoRef = useRef<HTMLVideoElement>(null);
    const [pastedCode, setPastedCode] = useState("");
    const [cameraError, setCameraError] = useState<string | null>(null);
    const [cameraSession, setCameraSession] = useState(0);
    const cameraActive = cameraSession > 0;
    const [supportsCamera] = useState(
        () =>
            typeof window !== "undefined" &&
            "BarcodeDetector" in window &&
            Boolean(navigator.mediaDevices),
    );

    useEffect(() => {
        if (!supportsCamera || cameraSession === 0) return;
        let stream: MediaStream | undefined;
        let cancelled = false;
        const stopCamera = () => {
            cancelled = true;
            stream?.getTracks().forEach((track) => {
                track.stop();
            });
            stream = undefined;
            if (videoRef.current) videoRef.current.srcObject = null;
        };
        const start = async () => {
            try {
                stream = await navigator.mediaDevices.getUserMedia({
                    video: true,
                });
                if (cancelled) {
                    stream?.getTracks().forEach((track) => {
                        track.stop();
                    });
                    return;
                }
                if (videoRef.current) videoRef.current.srcObject = stream;
                const Detector = (
                    window as unknown as {
                        BarcodeDetector: new (opts: {
                            formats: string[];
                        }) => {
                            detect: (
                                source: HTMLVideoElement,
                            ) => Promise<{ rawValue: string }[]>;
                        };
                    }
                ).BarcodeDetector;
                const detector = new Detector({ formats: ["qr_code"] });
                const tick = async () => {
                    if (cancelled || !videoRef.current) return;
                    let codes: { rawValue: string }[];
                    try {
                        codes = await detector.detect(videoRef.current);
                    } catch {
                        stopCamera();
                        setCameraError(
                            "No se pudo leer el código con la cámara. Pega el enlace que te dio el barista.",
                        );
                        return;
                    }
                    const proofId = codes[0]?.rawValue?.split("/purchase/")[1];
                    if (proofId) {
                        routerRef.current.push(`/purchase/${proofId}`);
                        return;
                    }
                    requestAnimationFrame(() => void tick());
                };
                requestAnimationFrame(() => void tick());
            } catch {
                setCameraError("No se pudo acceder a la cámara.");
            }
        };
        void start();
        return stopCamera;
    }, [cameraSession, supportsCamera]);

    const openPastedCode = () => {
        const proofId = extractProofId(pastedCode);
        if (proofId) router.push(`/purchase/${proofId}`);
    };

    return (
        <div className="mx-auto grid w-full max-w-md gap-5">
            <section className="grid gap-2">
                <span className="consumer-eyebrow">Tu visita cuenta</span>
                <h1 className="consumer-title text-4xl font-bold">
                    Escanear compra
                </h1>
                <p>
                    Escanea el código que te dio el barista para registrar tu
                    visita.
                </p>
            </section>
            {supportsCamera && cameraActive && !cameraError ? (
                <video
                    ref={videoRef}
                    autoPlay
                    muted
                    playsInline
                    aria-label="Vista de la cámara para escanear"
                    className="min-h-11 w-full rounded-3xl border border-[var(--color-line)] bg-black"
                />
            ) : (
                <div className="consumer-panel grid gap-3 p-5 text-[var(--color-ink-2)] text-sm">
                    <p>
                        {cameraError ??
                            "Puedes abrir la cámara cuando estés listo."}{" "}
                        Pega el enlace o código que te dio el barista.
                    </p>
                    {supportsCamera && (
                        <Button
                            className="min-h-11"
                            onClick={() => {
                                setCameraError(null);
                                setCameraSession((session) => session + 1);
                            }}
                        >
                            {cameraError ? "Reintentar cámara" : "Abrir cámara"}
                        </Button>
                    )}
                </div>
            )}
            <div className="flex gap-2">
                <Input
                    className="min-h-11"
                    value={pastedCode}
                    onChange={(event) => setPastedCode(event.target.value)}
                    placeholder="Pega el enlace o código"
                    aria-label="Código de compra"
                />
                <Button className="min-h-11 min-w-11" onClick={openPastedCode}>
                    Abrir
                </Button>
            </div>
        </div>
    );
}
