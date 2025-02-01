export const hexToUint8Array = (hex: string): Uint8Array => {
  hex = hex.startsWith('0x') ? hex.substr(2) : hex
  if (hex.length % 2 !== 0)
    throw new Error('hex must have length that is multiple of 2')
  const arr = new Uint8Array(hex.length / 2)
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(hex.substr(i * 2, 2), 16)
  }
  return arr
}
