export function toAnthropicContent(content: any): string | any[] {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";

  const blocks: any[] = [];
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") {
      blocks.push({ type: "text", text: part.text });
      continue;
    }
    if (part?.type !== "image_url" || typeof part.image_url?.url !== "string") continue;

    const url = part.image_url.url;
    const dataUri = url.match(/^data:([^;]+);base64,(.+)$/s);
    if (dataUri) {
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: dataUri[1], data: dataUri[2] },
      });
    } else if (/^https?:\/\//i.test(url)) {
      blocks.push({ type: "image", source: { type: "url", url } });
    }
  }
  return blocks.length ? blocks : "";
}
