export const bytesToMegabytes = (bytes: number): number => {
  const kilobytes = bytes / 1024
  const megabytes = kilobytes / 1024
  return megabytes
}
