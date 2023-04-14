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

  const response = await message.json();

  return response.result;
}

export const sendChatAction: TelegramBotMethods['sendChatAction'] = async (chatId, action) => {
  const message = await fetch(`${baseURL}/sendChatAction`, {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      chat_id: chatId,
      action,
    }), // body data type must match "Content-Type" header
  });

  return message.json();
}

export const getFile: TelegramBotMethods['getFile'] = async (fileId) => {
  const message = await fetch(`${baseURL}/getFile`, {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file_id: fileId,
    }), // body data type must match "Content-Type" header
  });

  const response = await message.json();

  return response.result;
}

export const editMessageText: TelegramBotMethods['editMessageText'] = async (text,options) => {
  try {
  const message = await fetch(`${baseURL}/editMessageText`, {
    method: "POST", // *GET, POST, PUT, DELETE, etc.
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      text,
      ...options,
    }), // body data type must match "Content-Type" header
  });

  const result = await message.json()

   if (!result.ok) {
      if (result.error_code === 429 ) {
        const {parameters: {retry_after}} = result;
        await new Promise((resolve) => setTimeout(resolve, retry_after * 1000));
        return editMessageText(text, options);
      }
      console.error("Error editing message text:", result.description);
      return false;
    }
    return true;
  } catch (err) {
    console.error("Error editing message text:", err);
    return false;
  }
}