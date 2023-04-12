import { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';
import { DOC_SIZE, EXCLUDE_LINK_LIST } from "./constants";

/**
 * Normalize a link to a full URL
 * 
 * @param link The link to normalize
 * @returns The normalized link
 */
export const normalizeLink = (link: string) => {
    const parsedLink = new URL(link);
    parsedLink.hash = '';
    parsedLink.search = '';
    return parsedLink.href;
}


export const isValidUrl = async (something: string) => {
    try {
        const url = new URL(something);
        const response = await fetch(url);
        return response.ok;
    } catch (_) {
        return false;
    }
}

/*
    Fetches and parses a url

    @param url string
    @returns CheerioAPI object
*/
const fetchAndParse = async (url: string): Promise<CheerioAPI | null>  => {
    try {
        const response = await fetch(url);
        const html = await response.text();
        const $ = cheerio.load(html);
        return $;
    } catch (err) {
        console.error(`Unable to fetch and parse ${url}: ${err}`);
        throw new Error(`Unable to fetch and parse ${url}: ${err}`);
        return null;
    }
}

/*
    Extracts all links from a CheerioAPI object

    @param $ CheerioAPI object
    @returns string[] of links
*/
const extractLinks = ($: CheerioAPI) => {
    const links:string[] = [];
    const linkTags = $("a");

    linkTags.each((i, el) => {
        const link = $(el).attr("href");
        if (link && !link.startsWith('#') && !links.includes(link)) {
            links.push(link);
        }
    })
    return links;
}


const parsePage = async (
  url: string,
  maxDepth: number
): Promise<Document[]> => {
  const visitedLinks: Set<string> = new Set();
  const baseURL = new URL(url).origin;
  const documents: any[] = [];

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


/**
 * Clean source text
 * 
 * @param text - source text
 * @returns cleaned text
 */
const cleanSourceText = (text: string) => {
  return text
    .trim()
    .replace(/(\n){3,}/g, "\n\n") // Replace 3 or more newlines with two newlines
    .replace(/ {2,}/g, " ") // Replace 2 or more spaces with a single space
    .replace(/\t/g, "") // Remove tab characters
    .replace(/\\("|\\)/g, '') // Remove unnecessary characters like \"
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*|`[^`]*`|'[^']*'|"[^"]*"|\/\/[^\n]*\n|\/\*[^]*?\*\/|;|\s*\(.*?\).*?\{[^]*?\}|[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?\s*(?=\W|$)/g, '') // Remove JS-related code
    .replace(/\n\s*\n/g, "\n"); // Replace newlines followed by whitespace and another newline with a single newline
}

/**
 * Checks if a URL is internal to a base URL
 * 
 * @param url The URL to check
 * @param baseUrl The base URL to compare against
 * @returns true if the URL is internal to the base URL
 */

export const isInternalLink = (link: string, baseURL: string) => {
    return link.startsWith(baseURL) || (link.startsWith('/') && !link.startsWith('//'));
}


export const getHost = (subdomain?: string) => {
    const host =
      process.env.NODE_ENV === 'development'
        ? 'localhost:3000'
        : process.env.NEXT_PUBLIC_APP_HOSTNAME;
    return subdomain ? `${subdomain}.${host}` : host;
  };