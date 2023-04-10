

/**
 * Clean source text
 * 
 * @param text - source text
 * @returns cleaned text
 */
export const cleanSourceText = (text: string) => {
  return text
    .trim()
    .replace(/(\n){3,}/g, "\n\n") // Replace 3 or more newlines with two newlines
    .replace(/ {2,}/g, " ") // Replace 2 or more spaces with a single space
    .replace(/\t/g, "") // Remove tab characters
    .replace(/\\("|\\)/g, '') // Remove unnecessary characters like \"
    .replace(/\/\*[\s\S]*?\*\/|\/\/.*|`[^`]*`|'[^']*'|"[^"]*"|\/\/[^\n]*\n|\/\*[^]*?\*\/|;|\s*\(.*?\).*?\{[^]*?\}|[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?\s*(?=\W|$)/g, '') // Remove JS-related code
    .replace(/\n\s*\n/g, "\n"); // Replace newlines followed by whitespace and another newline with a single newline
}