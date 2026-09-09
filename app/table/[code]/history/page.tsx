import type { Metadata } from "next";
import Link from "next/link";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { StoryHistoryClient } from "./history-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "故事档案", description: "保存跑团经历，从历史中的另一个起点开始新的篇章。" };

export default async function StoryHistoryPage({ params }: { params: Promise<{ code: string }> }) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const user = await getChatGPTUser();
  if (!user) return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-5 text-fg">
      <section className="w-full max-w-xl rounded-[28px] border border-border bg-surface p-7 text-center">
        <h1 className="font-display text-3xl">登录后查看故事档案</h1>
        <Link href={`/login?next=${encodeURIComponent(`/table/${code}/history`)}`}
          className="mt-6 inline-flex text-sm text-brass hover:text-fg">去登录</Link>
      </section>
    </main>
  );
  return <StoryHistoryClient code={code} userName={user.displayName} accountId={user.userId} />;
}
