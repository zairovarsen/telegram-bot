


const parseTelegramMessage = (message: string) => {
    const match = message.match(/^\/url (.+)/);
    if (match) {
      const url = match[1];
      return url;
    } else {
      return null;
    }
}

export default parseTelegramMessage;