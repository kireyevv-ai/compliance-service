const DOCUMENT_EXTENSIONS = new Set([".pdf", ".doc", ".docx"]);
const BINARY_EXTENSIONS = new Set([
  ".7z",
  ".avi",
  ".bmp",
  ".gif",
  ".gz",
  ".jpeg",
  ".jpg",
  ".mkv",
  ".mov",
  ".mp3",
  ".mp4",
  ".png",
  ".rar",
  ".svg",
  ".tar",
  ".webm",
  ".webp",
  ".zip"
]);

export function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlText(match[1]).trim() : "";
}

export function extractHrefValues(html: string): string[] {
  const values: string[] = [];
  const pattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(html)) !== null) {
    const href = match[1] ?? match[2] ?? match[3];
    if (href) {
      values.push(decodeHtmlText(href.trim()));
    }
  }

  return values;
}

export function isHtmlContentType(contentType: string): boolean {
  return contentType.toLowerCase().split(";")[0].trim() === "text/html";
}

export function isDocumentUrl(url: URL): boolean {
  return DOCUMENT_EXTENSIONS.has(fileExtension(url.pathname));
}

export function isBinaryUrl(url: URL): boolean {
  return BINARY_EXTENSIONS.has(fileExtension(url.pathname));
}

export function shouldSkipAsPage(url: URL): boolean {
  return isDocumentUrl(url) || isBinaryUrl(url);
}

function fileExtension(pathname: string): string {
  const last = pathname.toLowerCase().split("/").pop() ?? "";
  const index = last.lastIndexOf(".");
  return index >= 0 ? last.slice(index) : "";
}

function decodeHtmlText(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
