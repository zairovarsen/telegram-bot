import { CheerioAPI } from "cheerio";


/*
    Extracts all links from a CheerioAPI object

    @param $ CheerioAPI object
    @returns string[] of links
*/
export const extractLinks = ($: CheerioAPI) => {
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