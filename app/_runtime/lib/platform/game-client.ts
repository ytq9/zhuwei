"use client";

const UNCONFIRMED_RESULT = "若刚提交过操作，请先刷新桌面确认结果；需要恢复时使用原操作的重试入口，避免另发相同行动。";

function httpFailure(status: number): string {
  switch (status) {
    case 400:
    case 415:
    case 422:
      return "请求内容未被接受。请检查必填项和当前选项；若由页面自动提交，请刷新后再试，持续失败时联系维护者。";
    case 401:
      return "登录会话无效或已过期。请重新登录，再打开原来的房间。";
    case 403:
      return "当前账号没有完成这项操作的权限。请确认登录账号、房间席位和角色控制权，或联系房主处理。";
    case 404:
      return "请求的房间或服务入口不存在。请刷新页面并核对房间码；仍无法打开时联系房主。";
    case 409:
      return "请求与当前状态冲突。请刷新桌面，按最新状态重新选择目标或选项。";
    case 413:
      return "提交的内容超过服务大小限制。请缩短文字或录音后再试。";
    case 429:
      return "请求过于频繁或服务额度受限。请稍候再试；持续出现时联系房主或维护者检查额度。";
    case 502:
    case 503:
      return `服务器暂时无法完成响应（${status}），可能正在繁忙或连接上游失败。${UNCONFIRMED_RESULT}`;
    case 408:
    case 504:
      return `请求等待超过服务时限（${status}），尚未确认处理结果。${UNCONFIRMED_RESULT}`;
    default:
      return `服务器返回错误（${status}），具体原因尚未确认。${UNCONFIRMED_RESULT}持续失败时请联系维护者。`;
  }
}

/** The game route exposes only explicitly public errors. Never surface a
 * gateway body, a JSON parser exception, or a browser transport diagnostic. */
export async function callGame<T>(command: string, data?: unknown): Promise<T> {
  const body = JSON.stringify({ command, data });
  let response: Response;
  try {
    response = await fetch("/api/game", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  } catch {
    throw new Error(`未能连接到游戏服务，或连接在完成前中断。请检查网络连接。${UNCONFIRMED_RESULT}`);
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error(response.ok
      ? `服务器响应未能完整读取，或返回了无法识别的内容。${UNCONFIRMED_RESULT}`
      : httpFailure(response.status));
  }
  if (!response.ok) {
    const publicError = payload !== null && typeof payload === "object"
      && "error" in payload && typeof payload.error === "string"
      ? payload.error.trim()
      : "";
    throw new Error(`${publicError ? `${publicError} ` : ""}${httpFailure(response.status)}`);
  }
  if (payload === null || typeof payload !== "object") {
    throw new Error(`服务器返回了无法识别的内容。${UNCONFIRMED_RESULT}`);
  }
  return payload as T;
}
