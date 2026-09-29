import type { MetadataRoute } from "next";

// Installable PWA (Spec §2). Opens on the clock redirect: the thing staff reach for first.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Shiftwise",
    short_name: "Shiftwise",
    description: "Scheduling and time clock for small teams",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#ffffff",
    theme_color: "#111111",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [{ name: "Clock in / out", short_name: "Clock", url: "/clock", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] }],
  };
}
