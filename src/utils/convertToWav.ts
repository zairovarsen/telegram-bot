import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import fs from 'fs'
ffmpeg.setFfmpegPath(ffmpegPath.path)

export const convertToWav = async (
  inputPath: string,
  outputPath: string,
): Promise<void> => {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .output(outputPath)
      .format('wav')
      .on('end', () => {
        resolve()
      })
      .on('error', err => {
        console.error('Error converting to WAV:', err)
        reject(err)
      })
      .run()
  })
}

// Function to get the file size in MB
export const getFileSizeInMb = (filePath: string): number => {
  const fileSizeInBytes = fs.statSync(filePath).size
  return fileSizeInBytes / (1024 * 1024)
}
