// Image generation endpoint for QStash
import { qReceiver } from "@/lib/qstash";
import { NextApiRequest, NextApiResponse } from "next";
import { bot } from "@/lib/bot";
import {
  GENERATED_IMAGE_MESSAGE,
  IMAGE_GENERATION_ERROR_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
} from "@/utils/constants";
import { processImage } from "@/lib/image";
import { backOff } from "exponential-backoff";
import { readRequestBody } from "@/utils/readRawBody";

// The body of the request sent by QStash
export type ImageBody = {
    chatId: number;
    messageId: number;
    fileId: string;
    userId: number;
    conversionModel: string;
}

export interface VerifyRequest extends NextApiRequest {
  signature: string;
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
    fileId,
    userId,
    conversionModel,
  } = body as ImageBody;

  if (!chatId || !messageId || !fileId || !userId || !conversionModel) {
    console.error("Invalid body");
    await bot.telegram.sendMessage(chatId, IMAGE_GENERATION_ERROR_MESSAGE, {
        reply_to_message_id: messageId,
    });
    res.status(400).send("Bad Request");
    return;
  }

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
  } 

export const config = {
  api: {
    bodyParser: false,
  },
};
