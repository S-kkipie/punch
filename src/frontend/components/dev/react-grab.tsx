"use client";

import { useEffect } from "react";

// Dev-only: react-grab lets you alt-click any component in the browser and
// copy its source context. Never ships to production builds.
export function ReactGrab() {
    useEffect(() => {
        if (process.env.NODE_ENV !== "development") return;
        void import("react-grab");
    }, []);
    return null;
}
