export function stripInternalMarkup(text: string): string {
  return text
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
