

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