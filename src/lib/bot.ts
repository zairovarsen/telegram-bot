import { TelegramBot, TelegramBotMethods  } from "@/types";

const baseURL = `https://api.telegram.org/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}`


export const sendMessage: TelegramBotMethods['sendMessage'] = async (chatId, text, options) => {
  const message = await fetch(`${baseURL}/sendMessage`, {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...options,
    }), // body data type must match "Content-Type" header
  });

  return message.json();
}



