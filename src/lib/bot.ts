import { TelegramBot, TelegramBotMethods } from '@/types'

export const baseURL = `https://api.telegram.org/bot${process.env.NEXT_PUBLIC_TELEGRAM_TOKEN}`

export const sendMessage: TelegramBotMethods['sendMessage'] = async (
  chatId,
  text,
  options,
) => {
  const message = await fetch(`${baseURL}/sendMessage`, {
    method: 'POST', // *GET, POST, PUT, DELETE, etc.
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      ...options,
    }), // body data type must match "Content-Type" header
  })

  const response = await message.json()

  return response.result
}

export const sendAudio: TelegramBotMethods['sendAudio'] = async (
  chatId,
  audio,
  options,
) => {
  const formData = new FormData()
  formData.append('chat_id', chatId as string)
  formData.append(
    'audio',
    new Blob([audio as Buffer], { type: 'audio/mpeg' }),
    'audio.mp3',
  )
  formData.append('reply_to_message_id', options?.reply_to_message_id as any)

  const message = await fetch(`${baseURL}/sendAudio`, {
    method: 'POST', // *GET, POST, PUT, DELETE, etc.
    body: formData,
  })

  if (!message.ok) {
    throw new Error(`HTTP error: ${message.status}`)
  }

  const response = await message.json()
  return response.result
}

export const sendInvoice: TelegramBotMethods['sendInvoice'] = async (
  chatId,
  title,
  description,
  payload,
  providerToken,
  currency,
  prices,
  options,
) => {
  let body = {
    chat_id: chatId,
    title,
    description,
    payload,
    provider_token: providerToken,
    currency,
    prices,
    ...options,
  }

  const message = await fetch(`${baseURL}/sendInvoice`, {
    method: 'POST', // *GET, POST, PUT, DELETE, etc.
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body), // body data type must match "Content-Type" header
  })

  const response = await message.json()

  console.log(response)

  return response.result
}

export const sendDocument: TelegramBotMethods['sendDocument'] = async (
  chatId,
  document,
  options,
) => {
  const message = await fetch(`${baseURL}/sendDocument`, {
    method: 'POST', // *GET, POST, PUT, DELETE, etc.
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      document,
      ...options,
    }), // body data type must match "Content-Type" header
  })

  const response = await message.json()

  return response.result
}

export const sendChatAction: TelegramBotMethods['sendChatAction'] = async (
  chatId,
  action,
) => {
  const message = await fetch(`${baseURL}/sendChatAction`, {
    method: 'POST', // *GET, POST, PUT, DELETE, etc.
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      chat_id: chatId,
      action,
    }), // body data type must match "Content-Type" header
  })

  return message.json()
}

export const getFile: TelegramBotMethods['getFile'] = async fileId => {
  const message = await fetch(`${baseURL}/getFile`, {
    method: 'POST', // *GET, POST, PUT, DELETE, etc.
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      file_id: fileId,
    }), // body data type must match "Content-Type" header
  })

  const response = await message.json()

  return response.result
}

export const editMessageText: TelegramBotMethods['editMessageText'] = async (
  text,
  options,
) => {
  try {
    const message = await fetch(`${baseURL}/editMessageText`, {
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        text,
        ...options,
      }), // body data type must match "Content-Type" header
    })

    const result = await message.json()

    if (!result.ok) {
      if (result.error_code === 429) {
        const {
          parameters: { retry_after },
        } = result
        await new Promise(resolve => setTimeout(resolve, retry_after * 1000))
        return editMessageText(text, options)
      }
      console.error('Error editing message text:', result.description)
      return false
    }
    return true
  } catch (err) {
    console.error('Error editing message text:', err)
    return false
  }
}

export const answerCallbackQuery: TelegramBotMethods['answerCallbackQuery'] =
  async (callbackQueryId, options = undefined) => {
    let body = {
      callback_query_id: callbackQueryId,
    }

    if (options) {
      body = {
        ...body,
        ...options,
      }
    }

    const message = await fetch(`${baseURL}/answerCallbackQuery`, {
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body), // body data type must match "Content-Type" header
    })

    if (message.ok) {
      return true
    }

    return false
  }

export const answerPreCheckoutQuery: TelegramBotMethods['answerPreCheckoutQuery'] =
  async (preCheckoutQueryId, ok, options = undefined) => {
    let body = {
      pre_checkout_query_id: preCheckoutQueryId,
      ok,
    }

    if (options) {
      body = {
        ...body,
        ...options,
      }
    }

    const message = await fetch(`${baseURL}/answerPreCheckoutQuery`, {
      method: 'POST', // *GET, POST, PUT, DELETE, etc.
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body), // body data type must match "Content-Type" header
    })

    if (message.ok) {
      return true
    }

    return false
  }
