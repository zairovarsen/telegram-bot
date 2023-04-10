export const isValidUrl = async (something: string) => {
    try {
        const url = new URL(something);
        const response = await fetch(url);
        return response.ok;
    } catch (_) {
        return false;
    }
}





