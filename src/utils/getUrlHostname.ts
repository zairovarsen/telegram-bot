export const getUrlHostnameOrPdfName = (url: string) => {
    if (url.endsWith('.pdf')) {
        return url.substring(url.lastIndexOf('/') + 1)
    } else {
        return new URL(url).hostname
    }
}