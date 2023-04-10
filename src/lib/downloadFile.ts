




const downloadFile = async (url: string) => {
    const response = await fetch(url);
    console.log(response);
};

export default downloadFile;
