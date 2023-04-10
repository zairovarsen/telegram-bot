
import pdfParse from "pdf-parse";
import { DOC_SIZE } from "./constants";
import { Document } from './../types/index';

const getDocumentPdf = async (url: string): Promise<Document[]> => {
  const document: Document[] = [];
  const response = await fetch(url);

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const data = await pdfParse(buffer);

  const lines = data.text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("");
  let start = 0;

  while (start < lines.length) {
    const end = start + DOC_SIZE;
    const chunk = lines.slice(start, end);
    document.push({ url, body: chunk });
    start = end;
  }

  return document;
};

export default getDocumentPdf;
      
