import type { Metadata } from "next";
import Link from "next/link";
import { listMyRooms } from "@/lib/table/server";
import { getChatGPTUser } from "../chatgpt-auth";
import { HallClient } from "./hall-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "酒馆",
  description: "开一张新桌，或凭房间码加入朋友的烛帷跑团。",
};

export default async function HallPage() {
  const user = await getChatGPTUser();
  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg px-5 text-fg">
        <section className="w-full max-w-xl rounded-[28px] border border-border bg-surface p-7 md:p-10">
          <p className="text-xs tracking-[0.2em] text-brass">酒馆门口</p>
          <h1 className="mt-2 font-display text-3xl">先登录，再入座</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">
            用邮箱登录或注册一个座位。身份由这座 Cloudflare Worker 和 D1 验证，不会使用开发假用户。
          </p>
          <div className="mt-6 flex gap-4 text-sm">
            <Link href="/login?next=%2Fhall" className="text-brass hover:text-fg">登录</Link>
            <Link href="/register?next=%2Fhall" className="text-brass hover:text-fg">注册</Link>
            <Link href="/" className="text-subtle hover:text-fg">返回首页</Link>
          </div>
        </section>
      </main>
    );
  }
  const rooms = await listMyRooms({ data: undefined, userId: user.userId });
  return <HallClient userName={user.displayName} initialRooms={rooms} />;
}
