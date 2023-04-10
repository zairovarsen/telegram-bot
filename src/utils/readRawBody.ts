import { NextApiRequest } from "next";


export async function readRequestBody(req: NextApiRequest): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: any[] = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        resolve(Buffer.concat(chunks).toString());
      });
      req.on("error", (err) => {
        reject(err);
      });
    });
  }