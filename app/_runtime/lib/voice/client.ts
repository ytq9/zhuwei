"use client";

import { callGame as call } from "@/lib/platform/game-client";

type Args = { data: any };
export const transcribeAudio = ({ data }: Args) => call<any>("transcribeAudio", data);
export const speakNarration = ({ data }: Args) => call<any>("speakNarration", data);
