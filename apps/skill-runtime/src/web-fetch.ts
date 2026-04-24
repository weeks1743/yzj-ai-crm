import type { FetchLike, WebFetchExtractResult } from './contracts.js';
import { ExternalServiceError } from './errors.js';

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripTags(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function extractFirstMatch(html: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern);
  if (!match?.[1]) {
    return undefined;
  }

  return stripTags(match[1]);
}

function extractRawMatch(html: string, pattern: RegExp): string | undefined {
  const match = html.match(pattern);
  return match?.[1];
}

function extractLinks(html: string, baseUrl: string): Array<{ text: string; url: string }> {
  const links: Array<{ text: string; url: string }> = [];
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of html.matchAll(regex)) {
    const href = match[1]?.trim();
    if (!href) {
      continue;
    }

    try {
      const resolvedUrl = new URL(href, baseUrl).toString();
      links.push({
        text: stripTags(match[2] || ''),
        url: resolvedUrl,
      });
    } catch {
      continue;
    }
  }

  return links.slice(0, 50);
}

function htmlToMarkdown(html: string): string {
  return decodeHtmlEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_match, tag, content) => {
        const level = Number(String(tag).slice(1));
        return `\n${'#'.repeat(level)} ${stripTags(String(content))}\n`;
      })
      .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_match, content) => `\n- ${stripTags(String(content))}`)
      .replace(/<(p|div|section|article|main|blockquote|tr)[^>]*>/gi, '\n')
      .replace(/<\/(p|div|section|article|main|blockquote|tr)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n[ \t]+/g, '\n')
      .trim(),
  );
}

function selectContentRoot(html: string): string {
  return (
    extractRawMatch(html, /<main\b[^>]*>([\s\S]*?)<\/main>/i) ||
    extractRawMatch(html, /<article\b[^>]*>([\s\S]*?)<\/article>/i) ||
    extractRawMatch(html, /<body\b[^>]*>([\s\S]*?)<\/body>/i) ||
    html
  );
}

export async function fetchAndExtract(
  url: string,
  fetchImpl: FetchLike = fetch,
): Promise<WebFetchExtractResult> {
  const response = await fetchImpl(url, {
    headers: {
      'User-Agent': 'yzj-ai-crm-skill-runtime/0.4.0',
      Accept: 'text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8',
    },
  });

  if (!response.ok) {
    throw new ExternalServiceError(`页面抓取失败: ${response.status} ${response.statusText}`, {
      url,
      status: response.status,
    });
  }

  const html = await response.text();
  const contentRoot = selectContentRoot(html);
  const title =
    extractFirstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) ||
    extractFirstMatch(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i) ||
    url;
  const contentMarkdown = htmlToMarkdown(contentRoot);

  return {
    url,
    title,
    contentMarkdown,
    plainText: stripTags(contentRoot),
    links: extractLinks(html, url),
    fetchedAt: new Date().toISOString(),
  };
}
