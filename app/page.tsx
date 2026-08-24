/* eslint-disable @next/next/no-img-element -- preserve the upstream GitHub markup */
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { chatGPTSignInPath, getChatGPTUser } from "./chatgpt-auth";
import { LogoutButton } from "./logout-button";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getChatGPTUser();
  return (
    <main className="min-h-dvh bg-bg text-fg">
      <header className="flex items-center justify-between px-5 py-4 md:px-10">
        <span className="font-display text-xl tracking-wide">烛帷</span>
        <div className="flex h-10 min-w-12 items-center justify-end">
          {user ? (
            <div className="flex items-center gap-2">
              <span className="max-w-28 truncate text-sm text-muted">{user.displayName}</span>
              <LogoutButton />
            </div>
          ) : (
            <Link className="text-sm text-fg/80 hover:text-fg" href={chatGPTSignInPath("/")}>登录</Link>
          )}
        </div>
      </header>

      <section className="relative mx-auto max-w-6xl px-5 pb-16 pt-6 md:px-10 md:pt-10">
        <div className="overflow-hidden rounded-[28px] border border-border">
          <div className="relative aspect-[16/11] min-h-[320px] md:aspect-[16/8]">
            <img src="/art/tavern.jpg" alt="烛火未灭的居酒屋" className="absolute inset-0 size-full object-cover" />
            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-bg via-bg/55 to-bg/10" />
            <div className="absolute inset-x-0 bottom-0 p-6 md:p-10">
              <p className="mb-2 text-xs tracking-[0.28em] text-brass uppercase">D&amp;D 5E · 3 级 · AI KP</p>
              <h1 className="max-w-xl font-display text-4xl leading-tight md:text-6xl">帷幕后，<br />烛火未灭</h1>
              <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted md:text-base">
                朋友围坐，你开口，骰子落地。AI 当 KP：叙事、裁决、对抗分席。失败是真的失败，秘密不会从旁白里漏出来。
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Button asChild size="lg"><Link href={user ? "/hall" : chatGPTSignInPath("/hall")}>进入酒馆</Link></Button>
                <Button asChild variant="ghost" size="lg"><Link href={user ? "/hall" : chatGPTSignInPath("/")}>登录</Link></Button>
                <Button asChild variant="ghost" size="lg"><a href="#module">今晚的案子</a></Button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-4 px-5 pb-16 md:grid-cols-3 md:px-10">
        {[
          { t: "完整 5e 建卡", d: "种族、职业、子职、点买、背景、技能、法术。3 级开团，建卡本身就是第一场戏。" },
          { t: "语音进出", d: "按住说话，转写成字，你确认后再进桌。KP 用有感情的嗓音读旁白，不剧透。" },
          { t: "房间与存档", d: "房主开房、房间码拉朋友。章节制，短团长团都能续。人物卡、线索、日志留在桌上。" },
        ].map((card) => (
          <article key={card.t} className="rounded-[18px] border border-border bg-surface p-5">
            <h2 className="font-display text-lg">{card.t}</h2>
            <p className="mt-2 text-sm leading-relaxed text-muted">{card.d}</p>
          </article>
        ))}
      </section>

      <section id="module" className="mx-auto max-w-6xl px-5 pb-24 md:px-10">
        <div className="grid overflow-hidden rounded-[28px] border border-border bg-surface md:grid-cols-2">
          <img src="/art/inn.jpg" alt="黑橡居酒屋" className="h-64 w-full object-cover md:h-full" />
          <div className="p-6 md:p-10">
            <p className="text-xs tracking-[0.2em] text-brass">第一本模组</p>
            <h2 className="mt-2 font-display text-3xl">黑橡居酒屋的第三份遗嘱</h2>
            <p className="mt-4 text-sm leading-relaxed text-muted">剑湾小镇暮烛镇。老板死在酒窖门口，嘴里塞着一片黑橡叶。三份遗嘱，三个说法。酒窖的门是新钉上的。门缝里有人在哼摇篮曲。</p>
            <p className="mt-3 text-sm leading-relaxed text-muted">社交、搜查、一场可以谈下来的对峙。线索会断，人会死。KP 不会为了主线改骰。</p>
            <p className="mt-6 text-xs text-subtle">2–5 人 · 约 3–5 小时短团 · 可续长线</p>
          </div>
        </div>
      </section>
    </main>
  );
}
