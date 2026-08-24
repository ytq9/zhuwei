"use client";

async function call<T>(command: string, data: unknown): Promise<T> {
  const response = await fetch("/api/game", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ command, data }),
  });
  const payload = (await response.json()) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "语音服务暂时没有回应");
  return payload;
}

type Args = { data: any };
export const transcribeAudio = ({ data }: Args) => call<any>("transcribeAudio", data);
export const speakNarration = ({ data }: Args) => call<any>("speakNarration", data);
