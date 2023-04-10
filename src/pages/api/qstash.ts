import { hget } from "@/lib/redis";
import { qReceiver } from "@/lib/qstash";
import { NextApiRequest, NextApiResponse } from "next";
import { bot } from "@/lib/bot";
import { processPdf } from "@/lib/pdf";
import {
  ERROR_GENERATING_EMBEDDINGS_MESSAGE,
  GENERATED_IMAGE_MESSAGE,
  INSUFFICIENT_TOKENS_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
  UNABLE_TO_PROCESS_PDF_MESSAGE,
} from "@/utils/constants";
import { hgetAll } from "@/lib/redis";
import { processImage, processImagePromptOpenJourney } from "@/lib/image";
import { backOff } from "exponential-backoff";

export interface VerifyRequest extends NextApiRequest {
  signature: string;
}

async function readRequestBody(req: NextApiRequest): Promise<string> {
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

export default async function handler(
  req: VerifyRequest,
  res: NextApiResponse
) {
  const signature = (req.headers["upstash-signature"] || "") as string;
  const rawBody = await readRequestBody(req);

  if (!signature) {
    res.status(401).send("Unauthorized");
    return;
  }

  try {
    const isFromUpstash = await qReceiver.verify({
      signature,
      body: rawBody,
    });

    if (!isFromUpstash) {
      console.error("Received event from unauthorized source");
      res.status(401).send("Unauthorized");
      return;
    }
  } catch (error) {
    console.error(error);
    res.status(500).send("Internal Server Error");
    return;
  }

  const body = JSON.parse(rawBody);
  const {
    chatId,
    messageId,
    mimeType,
    fileId,
    userId,
    conversionModel,
    prompt,
    text,
  } = body;
  console.log(body);

  if (mimeType == "application/pdf") {
    try {
      const key = `user:${userId}`;
      const tokens = parseInt((await hget(key, "tokens")) || "0");
      if (!tokens) {
        await bot.telegram.sendMessage(chatId, INSUFFICIENT_TOKENS_MESSAGE, {
          reply_to_message_id: messageId,
        });
        res.status(200).send("OK");
        return;
      }

      console.log(`Tokens: ${tokens}`);
      const file = await bot.telegram.getFile(fileId);
      const pdfPath = `https://api.telegram.org/file/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}/${file.file_path}`;
      const pdf = await processPdf(pdfPath, tokens, userId);

      if (!pdf.success) {
        let message = "";
        if (pdf.errorMessage && typeof pdf.errorMessage === "string") {
          message = pdf.errorMessage;
        } else if (pdf.errorMessage && Array.isArray(pdf.errorMessage)) {
          message += `${ERROR_GENERATING_EMBEDDINGS_MESSAGE}\n\n`;
          message = pdf.errorMessage.join("\n");
          message += "\n";
          message =
            "Please review the errors and consider making necessary adjustments to your file before trying again. If you have any questions or need assistance, feel free to reach out to our support team.";
        } else {
          message = UNABLE_TO_PROCESS_PDF_MESSAGE;
        }

        await bot.telegram.sendMessage(chatId, message, {
          reply_to_message_id: messageId,
        });
        res.status(200).send("OK");
        return;
      }

      console.log(`Remaining tokens: ${pdf.tokenCount}`);
      res.status(200).send("OK");
    } catch (err) {
      console.error(err);
      res.status(500).send(INTERNAL_SERVER_ERROR_MESSAGE);
    }
  } else if (mimeType == "application/jpeg") {
    try {
      const file = await bot.telegram.getFile(fileId);
      const imagePath = `https://api.telegram.org/file/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}/${file.file_path}`;
      console.log(imagePath);

      const image = await processImage(imagePath, userId, conversionModel);

      if (!image.success) {
        await bot.telegram.sendMessage(chatId, image.errorMessage, {
          reply_to_message_id: messageId,
        });
        res.status(200).send("OK");
        return;
      }

      try {
        // Sometimes the bot will fail to send the image, so we retry a few times
        await backOff(
          () => {
            return bot.telegram.sendDocument(chatId, image.fileUrl as string, {
              caption: `\n${GENERATED_IMAGE_MESSAGE}`,
              reply_to_message_id: messageId,
            });
          },
          {
            startingDelay: 1000,
            numOfAttempts: 3,
            retry(e, attemptNumber) {
              console.error(`Attempt ${attemptNumber} failed`);
              console.error(e);
              return true;
            },
          }
        );
      } catch (err) {
        console.error(err);
      }
      console.log(
        `Remaining imageGenerations: ${image.imageGenerationsRemaining || 0}`
      );
      res.status(200).send("OK");
    } catch (err) {
      console.error(err);
      res.status(500).send(INTERNAL_SERVER_ERROR_MESSAGE);
    }
  } else if (mimeType == "text/plain") {
    if (text == "Imagine") {
      try {
        const image = await processImagePromptOpenJourney(prompt, userId);

        if (!image.success) {
          await bot.telegram.sendMessage(chatId, image.errorMessage, {
            reply_to_message_id: messageId,
          });
          res.status(200).send("OK");
          return;
        }

        try {
          // Sometimes the bot will fail to send the image, so we retry a few times
          await backOff(
            () => {
              return bot.telegram.sendDocument(
                chatId,
                image.fileUrl as string,
                {
                  caption: `\n${GENERATED_IMAGE_MESSAGE}`,
                  reply_to_message_id: messageId,
                }
              );
            },
            {
              startingDelay: 1000,
              numOfAttempts: 3,
              retry(e, attemptNumber) {
                console.error(`Attempt ${attemptNumber} failed`);
                console.error(e);
                return true;
              },
            }
          );
        } catch (err) {
          console.error(err);
        }
        console.log(
          `Remaining imageGenerations: ${image.imageGenerationsRemaining || 0}`
        );
        res.status(200).send("OK");
      } catch (err) {
        console.error(err);
        res.status(500).send(INTERNAL_SERVER_ERROR_MESSAGE);
      }
    } else {
      console.error("Unsupported text type");
      res.status(500).send("Internal Server Error");
      return;
    }
  } else {
    console.log("Unsupported mime type");
    res.status(200).send("OK");
  }
}

export const config = {
  api: {
    bodyParser: false,
  },
};
