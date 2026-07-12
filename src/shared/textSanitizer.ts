export function stripInternalMarkup(text: string): string {
  return text
    .replace(/<oai-mem-citation>[\s\S]*?<\/oai-mem-citation>/gi, "")
    .replace(/^[ \t]*::(?:git-[a-z-]+|created-thread|code-comment)\{[^\r\n]*\}[ \t]*(?:\r?\n|$)/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
