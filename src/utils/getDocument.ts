import { cleanSourceText } from './cleanSourceText';
import { Document } from './../types/index';
import { normalizeLink } from "./normalizeLink";
import { isInternalLink } from "./isInternalLink";
import { DOC_SIZE, EXCLUDE_LINK_LIST } from "./constants";
import { extractLinks } from "./extractLinks";
import { fetchAndParse } from "./fetchAndParse";

const parsePage = async (
  url: string,
  maxDepth: number
): Promise<Document[]> => {
  const visitedLinks: Set<string> = new Set();
  const baseURL = new URL(url).origin;
  const documents: Document[] = [];

  async function parseHelper(link: string, depth: number) {
    if (depth > maxDepth || visitedLinks.has(link)) {
      return;
    }

    visitedLinks.add(link);
    const $ = await fetchAndParse(link);

    if (!$) {
      console.error("Unable to fetch and parse url");
      throw new Error("Unable to fetch and parse url");
    }

    const sourceText = cleanSourceText($("body").text())

    let start = 0;
    while (start < sourceText.length) {
      const end = start + DOC_SIZE;
      const chunk = sourceText.slice(start, end);
      documents.push({ url, body: chunk });
      start = end;
    }

    const links = extractLinks($);
    for (const relativeLink of links) {
      if (isInternalLink(relativeLink, baseURL)) {
        const absoluteLink = normalizeLink(new URL(relativeLink, baseURL).href);
        await parseHelper(absoluteLink, depth + 1);
      }
    }
  }

  await parseHelper(url, 1);
  return documents;
};

export const getDocuments = async (url: string) => {
  const domain = new URL(url).hostname;

  if (EXCLUDE_LINK_LIST.includes(domain)) {
    throw new Error("Url is not allowed");
  }

  const documents = await parsePage(url, 3);
  return documents;
};
