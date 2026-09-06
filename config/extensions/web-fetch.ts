import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { Type } from "typebox"

const DEFAULT_MAX_CHARS = 50_000

async function fetch_body(url: string) {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(20_000),
        headers: { "User-Agent": "pi-web-fetch/1.0" },
    })
    return {
        contentType: response.headers.get("content-type") ?? "",
        body: await response.text(),
    }
}

function strip_html(html: string) {
    return html
        .replace(/<!--[\s\S]*?-->/g, " ")
        .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
        .replace(/<(br|p|div|li|tr|h[1-6])\b[^>]*>/gi, "\n")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/[ \t]+/g, " ")
        .replace(/\n\s*\n+/g, "\n")
        .trim()
}

async function fetch_and_strip(url: string, maxChars: number) {
    const { contentType, body } = await fetch_body(url)
    const text = contentType.includes("html") ? strip_html(body) : body.trim()
    return text.slice(0, maxChars)
}

export default function webFetchExtension(pi: ExtensionAPI) {
    pi.registerTool({
        name: "web_fetch",
        label: "Web Fetch",
        description: "Fetch a URL and return the body as text. HTML is stripped to readable text, other content types are returned as-is.",
        parameters: Type.Object({
            url: Type.String({ description: "Absolute http:// or https:// URL" }),
            maxChars: Type.Optional(Type.Number({ description: "Max characters to return (default 50000)" })),
        }),
        execute: async (_toolCallId, params) => {
            const maxChars = params.maxChars && params.maxChars > 0 ? Math.floor(params.maxChars) : DEFAULT_MAX_CHARS
            try {
                return { content: [{ type: "text", text: await fetch_and_strip(params.url, maxChars) }] }
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error)
                return { content: [{ type: "text", text: `web_fetch failed: ${message}` }] }
            }
        },
    })
}
