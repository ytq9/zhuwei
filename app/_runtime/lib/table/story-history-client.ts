"use client";

import { callGame } from "../platform/game-client";
import { callWithStableSubmission } from "./authoritative-client";
import type {
  CreateHistoricalRoomInput, CreateHistoricalRoomResult, ExportStoryHistoryPageInput,
  ListHistoricalStartsInput, StoryHistoricalStartsResult, StoryHistoryApiFailure, StoryViewerPageResult,
} from "../room/story-history-api-types";
import type { StoryViewerExport } from "../room/story-history/contracts";

export const exportStoryHistoryPage = (data: ExportStoryHistoryPageInput) =>
  callGame<StoryViewerPageResult>("exportStoryHistoryPage", data);
export const listHistoricalStarts = (data: ListHistoricalStartsInput) =>
  callGame<StoryHistoricalStartsResult>("listHistoricalStarts", data);

export async function createHistoricalRoom(data: Omit<CreateHistoricalRoomInput, "submissionId"> & { submissionId?: string }) {
  let storage: Storage | undefined;
  try { storage = window.sessionStorage; } catch { /* Current-tab retries still retain the explicit submission. */ }
  const response = await callWithStableSubmission({ command: "createHistoricalRoom", data, storage,
    invoke: async payload => {
      const result = await callGame<CreateHistoricalRoomResult>("createHistoricalRoom", payload);
      return { result, retryable: result.kind === "retryableFailure" };
    } });
  return response.result;
}

export function storyHistoryFailureMessage(failure: StoryHistoryApiFailure): string {
  switch (failure.code) {
    case "STORY_HISTORY_SOURCE_UNAVAILABLE": return "当前账号无法读取这间房的历史，请确认账号和房间席位。";
    case "STORY_HISTORY_MATERIALS_MISSING":
    case "STORY_HISTORY_ARCHIVE_INVALID": return "这段历史的保存材料不完整，暂时无法导出或从这里开团。";
    case "STORY_HISTORY_CUT_UNSUPPORTED":
    case "STORY_HISTORY_TIME_UNRESOLVED": return "这个历史时点暂时无法作为新团起点，请重新选择。";
    case "STORY_HISTORY_IDENTITY_UNSUPPORTED":
    case "STORY_HISTORY_IDENTITY_CONFLICT":
    case "STORY_HISTORY_CHARACTER_INVALID": return "这张人物卡无法以所选身份进入该事件，请调整人物或起点。";
    case "STORY_HISTORY_BINDING_INVALID":
    case "STORY_HISTORY_PROFILE_UNSUPPORTED": return "这段历史所需的模组或规则版本暂不可用。";
    case "STORY_HISTORY_REQUEST_CONFLICT": return "这次开团的内容与原提交不一致，请恢复原内容后重试。";
    case "STORY_HISTORY_REQUEST_INVALID": return "请求内容未被接受，请检查当前选项和人物卡。";
    case "STORY_HISTORY_PUBLICATION_PENDING": return "新团已经初始化，正在等待完成登记。请用下方按钮继续完成开团。";
    default: return failure.kind === "retryableFailure"
      ? "暂时未能确认结果。请稍后使用原请求重试。"
      : "暂时无法完成这项历史操作，请重新检查所选内容。";
  }
}

/** Every page remains a Viewer projection. Preserve its own content hash and
 * reject a moving snapshot or repeated cursor before offering a complete file. */
export async function collectStoryViewerExport(code: string, onProgress?: (messages: number) => void): Promise<readonly StoryViewerExport[]> {
  const pages: StoryViewerExport[] = [];
  const visited = new Set<string>();
  let cursor: string | null = null;
  let messages = 0;
  do {
    const result = await exportStoryHistoryPage({ code, cursor });
    if (result.kind !== "exported") throw new Error(storyHistoryFailureMessage(result));
    const page = result.export;
    const first = pages[0];
    if (page.format !== "zhuwei.story-viewer-export/v1" || !Array.isArray(page.transcript)
      || first && (JSON.stringify(first.source) !== JSON.stringify(page.source)
        || first.characterId !== page.characterId || first.projectionHash !== page.projectionHash)) {
      throw new Error("导出期间历史快照发生变化，请重新导出。");
    }
    pages.push(page);
    messages += page.transcript.length;
    onProgress?.(messages);
    cursor = page.nextCursor;
    if (cursor !== null) {
      if (typeof cursor !== "string" || !cursor || visited.has(cursor)) {
        throw new Error("历史分页未能继续，尚未生成完整导出文件。请稍后重试。");
      }
      visited.add(cursor);
    }
  } while (cursor !== null);
  return pages;
}
