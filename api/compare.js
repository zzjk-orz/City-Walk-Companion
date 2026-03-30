import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_KEY });
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  const { placeName } = req.query;
  if (!placeName) return res.status(400).json({ error: "Missing placeName" });

  try {
    // 1. 获取英文维基百科摘要
    const wikiUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=extracts&exintro&explaintext&format=json&origin=*&titles=${encodeURIComponent(placeName)}`;
    const wikiRes = await fetch(wikiUrl);
    const wikiData = await wikiRes.json();
    const pages = wikiData.query.pages;
    const wikiText = pages[Object.keys(pages)[0]]?.extract || "No detailed historical context found on Wikipedia.";

    const prompt = `你是一位深耕西雅图文化的资深金牌导游。请基于以下维基百科背景，为"${placeName}"编写一段约250字的中文历史文化故事。要求：语言生动有画面感，像是在散步时随口道来。
    背景资料：${wikiText}`;

    // 2. 并发调用三个最新模型
    const [sonnet, haiku, gemini] = await Promise.all([
      // Claude 3.7 Sonnet
      anthropic.messages.create({
        model: "claude-3-7-sonnet-20250219",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      }),
      // Claude 3.5 Haiku
      anthropic.messages.create({
        model: "claude-3-5-haiku-20241022",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }]
      }),
      // Gemini 2.0 Flash-Lite
      genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite-preview-02-05" })
        .generateContent(prompt)
    ]);

    res.status(200).json({
      wiki: wikiText,
      results: {
        sonnet: sonnet.content[0].text,
        haiku: haiku.content[0].text,
        gemini: gemini.response.text()
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}