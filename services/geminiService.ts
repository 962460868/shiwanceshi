import { GoogleGenAI } from "@google/genai";
import { EnvironmentInfo, LogEntry } from '../types';

let aiClient: GoogleGenAI | null = null;

// Initialize the client strictly with process.env.API_KEY
if (process.env.API_KEY) {
  aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY });
}

export const analyzeEnvironment = async (
  envInfo: EnvironmentInfo,
  logs: LogEntry[]
): Promise<string> => {
  if (!aiClient) {
    return "未检测到 Gemini API Key。请在环境变量中配置 API_KEY。";
  }

  const model = "gemini-2.5-flash";
  const recentLogs = logs.slice(-20).map(l => `[${l.level}] ${l.message} ${l.details || ''}`).join('\n');

  const prompt = `
    你是一位精通广告技术（AdTech）的资深前端工程师，专注于试玩广告（Playable Ads）、MRAID 标准以及移动端 WebView 兼容性。
    请根据以下环境信息和测试日志，对当前试玩广告的表现进行专业诊断。请使用中文回答。

    当前运行环境:
    - User Agent: ${envInfo.userAgent}
    - 操作系统平台: ${envInfo.platform}
    - 是否 iOS: ${envInfo.isIOS ? '是' : '否'}
    - 是否 Android: ${envInfo.isAndroid ? '是' : '否'}
    - MRAID 接口支持: ${envInfo.hasMraid ? '已检测到' : '未检测到'}

    测试日志 (最近记录):
    ${recentLogs}

    请分析并简要说明：
    1. 跳转行为分析：如果发生了跳转（redirect），失败的原因可能是什么？
    2. MRAID 兼容性：'mraid.open()' 在当前环境下是否被正确调用？
    3. 安全策略：是否存在浏览器弹窗拦截（Pop-up blocker）的风险？
    4. 商店跳转：针对当前 User Agent，预期的 Google Play 或 App Store 跳转行为应该是怎样的？

    回复要求：语言简洁专业，直接指出问题核心。
  `;

  try {
    const response = await aiClient.models.generateContent({
      model: model,
      contents: prompt,
    });
    return response.text || "无法生成分析结果。";
  } catch (error) {
    console.error("Gemini Analysis Error:", error);
    return "Gemini 分析服务暂时不可用，请稍后重试。";
  }
};