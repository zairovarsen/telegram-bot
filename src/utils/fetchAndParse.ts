import { CheerioAPI } from 'cheerio';
import * as cheerio from 'cheerio';

/*
    Fetches and parses a url

    @param url string
    @returns CheerioAPI object
*/
export const fetchAndParse = async (url: string): Promise<CheerioAPI | null>  => {
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