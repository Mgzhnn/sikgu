import type { Metadata, Viewport } from "next";
import "./globals.css";

const title = "SIKGU 식구 · DGIST 공동주문";
const description = "캠퍼스 가까운 식구와 메뉴를 모아 최소 주문금액과 배달비를 함께 해결하는 DGIST 공동주문 서비스.";

// The canonical public origin, fixed rather than read from the request:
// X-Forwarded-Host and Host are client-controlled, and the old code copied
// them into og:url and og:image, so anything caching the HTML could serve
// attacker-chosen link previews (security review 2026-10-24, F-5).
const siteOrigin = "https://sikgu-dgist.ugrp44group.chatgpt.site";

export const metadata: Metadata = {
  title,
  description,
  metadataBase: new URL(siteOrigin),
  openGraph: {
    title,
    description,
    type: "website",
    url: siteOrigin,
    locale: "ko_KR",
    siteName: "SIKGU",
    images: [{
      url: `${siteOrigin}/og.png`,
      width: 1734,
      height: 907,
      alt: "SIKGU — 혼자 넘기 어려운 최소 주문금액, 같이.",
    }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [`${siteOrigin}/og.png`],
  },
};

export const viewport: Viewport = {
  themeColor: "#10343b",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
