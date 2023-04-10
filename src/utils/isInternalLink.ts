


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