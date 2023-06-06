/* Calculate time difference */
export const convertDiffToTime = (diff: number) => {
  const hours = Math.floor(diff / 1000 / 60 / 60)
  const minutes = Math.floor(diff / 1000 / 60) - hours * 60
  const seconds = Math.floor(diff / 1000) - hours * 60 * 60 - minutes * 60

  return { hours, minutes, seconds }
}
