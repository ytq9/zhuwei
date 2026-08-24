import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import { Providers } from "./providers";

const title = "烛帷｜AI 主持的多人 D&D 跑团";
const description =
  "朋友围坐，开口行动，骰子落地。由 AI KP 主持、规则程序裁定的中文多人 D&D 5e 跑团站点。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host =
    requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  const forwardedProto = requestHeaders.get("x-forwarded-proto");
  const protocol = forwardedProto === "http" ? "http" : "https";
  const image = host ? protocol + "://" + host + "/og.png" : undefined;

  return {
    title: {
      default: title,
      template: "%s｜烛帷",
    },
    description,
    icons: {
      icon: "/favicon.svg",
      shortcut: "/favicon.svg",
    },
    openGraph: {
      type: "website",
      locale: "zh_CN",
      siteName: "烛帷",
      title,
      description,
      images: image
        ? [{ url: image, width: 1731, height: 909, alt: "烛帷：帷幕后，烛火未灭" }]
        : [],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: image ? [image] : [],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
