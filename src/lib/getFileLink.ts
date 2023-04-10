


const getFileLink = async (fileId: number) => {
    const url = `https://api.telegram.org/bot${process.env.NEXT_TELEGRAM_TOKEN}/getFile?file_id=${fileId}`;

    const response = await fetch(url);
    const data = await response.json();
    if (data.ok) {
        const fileUrl = `https://api.telegram.org/file/bot${process.env.NEXT_TELEGRAM_TOKEN}/${data.result.file_path}`;
        return fileUrl;
    } else {
        throw new Error(`Failed to get file link: ${data.error_code} ${data.description}`)
    }
};

export default getFileLink;
