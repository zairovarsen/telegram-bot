import { ConversionModel, ConversionModelAllButOpenJourney } from "@/types";
// Image generation endpoint for QStash
import { qReceiver } from "@/lib/qstash";
import { NextApiRequest, NextApiResponse } from "next";
import { bot } from "@/lib/bot";
import {
  GENERATED_IMAGE_MESSAGE,
  INTERNAL_SERVER_ERROR_MESSAGE,
} from "@/utils/constants";
import {
  ImageBody,
  ImageGenerationResult,
  parseRequestBody,
  processImage,
  processImagePromptOpenJourney,
} from "@/lib/image";
import { backOff } from "exponential-backoff";
import { readRequestBody } from "@/utils/readRawBody";

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
    console.error("Received event from unauthorized source");
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

    const imageBody: ImageBody = parseRequestBody(rawBody);
    const { chatId, messageId, userId, conversionModel } = imageBody;

    let image: ImageGenerationResult;
    if (imageBody.conversionModel === ConversionModel.OPENJOURNEY) {
      const { prompt } = imageBody;
      image = await processImagePromptOpenJourney(prompt, userId);
    } else {
      const { fileId } = imageBody;
      const file = await bot.telegram.getFile(fileId);
      const imagePath = `https://api.telegram.org/file/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}/${file.file_path}`;
      image = await processImage(imagePath, userId, conversionModel);
    }

    if (!image.success) {
      await bot.telegram.sendMessage(chatId, image.errorMessage, {
        reply_to_message_id: messageId,
      });
      res.status(200).send("OK");
      return;
    } else {
      const { fileUrl } = image;

      try {
        // Sometimes the bot will fail to send the image, so we retry a few times
        await backOff(
          () => {
            return bot.telegram.sendDocument(chatId, fileUrl, {
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
    }
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
