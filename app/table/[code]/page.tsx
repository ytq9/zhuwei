import type { Metadata } from "next";
import Link from "next/link";
import { getChatGPTUser } from "../../chatgpt-auth";
import { TableClient } from "./table-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "跑团桌",
  description: "烛帷多人跑团桌面。",
};

export default async function TablePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const user = await getChatGPTUser();
  if (!user) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-bg px-5 text-fg">
        <section className="w-full max-w-xl rounded-[28px] border border-border bg-surface p-7 text-center">
          <h1 className="font-display text-3xl">先登录，再入座</h1>
          <p className="mt-4 text-sm leading-relaxed text-muted">这张桌需要一个可信的烛帷账号。</p>
          <Link href={`/login?next=${encodeURIComponent(`/table/${code}`)}`} className="mt-6 inline-flex text-sm text-brass hover:text-fg">去登录</Link>
        </section>
      </main>
    );
  }
  return <TableClient code={code} userName={user.displayName} />;
}
