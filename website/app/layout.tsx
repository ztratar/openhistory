import type { Metadata } from "next";
import { headers } from "next/headers";
import { GoogleAnalyticsClickTracking } from "./google-analytics";
import "./globals.css";

const googleAnalyticsId = "G-WW2YG7LJ13";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const siteUrl = new URL(`${protocol}://${host}`);
  const socialImage = new URL("/og.png", siteUrl).toString();

  return {
    metadataBase: siteUrl,
    applicationName: "OpenHistory",
    title: "OpenHistory — Remember everything",
    description: "Turn your mac activity into a private timeline for you & your AI.",
    authors: [{ name: "Zach Tratar", url: "https://x.com/zachtratar" }],
    creator: "Zach Tratar",
    publisher: "OpenHistory",
    keywords: ["OpenHistory", "macOS", "activity history", "local-first", "MCP", "AI agents"],
    category: "productivity",
    alternates: { canonical: "/" },
    icons: {
      icon: [
        { url: "/openhistory-icon-32.png", sizes: "32x32", type: "image/png" },
        { url: "/openhistory-icon.png", sizes: "256x256", type: "image/png" },
      ],
      shortcut: "/openhistory-icon-32.png",
      apple: [{ url: "/openhistory-icon.png", sizes: "256x256", type: "image/png" }],
    },
    openGraph: {
      title: "OpenHistory — Remember everything",
      description: "Turn your mac activity into a private timeline for you & your AI.",
      type: "website",
      url: "/",
      siteName: "OpenHistory",
      locale: "en_US",
      images: [{ url: socialImage, width: 1200, height: 630, alt: "OpenHistory — Remember everything." }],
    },
    twitter: {
      card: "summary_large_image",
      title: "OpenHistory — Remember everything",
      description: "Turn your mac activity into a private timeline for you & your AI.",
      creator: "@zachtratar",
      site: "@zachtratar",
      images: [socialImage],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <script async src={`https://www.googletagmanager.com/gtag/js?id=${googleAnalyticsId}`} />
        <script
          dangerouslySetInnerHTML={{
            __html: `window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${googleAnalyticsId}');`,
          }}
        />
      </head>
      <body>
        {children}
        <GoogleAnalyticsClickTracking />
      </body>
    </html>
  );
}
