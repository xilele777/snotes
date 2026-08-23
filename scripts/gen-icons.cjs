const zlib = require('zlib')
const fs = require('fs')

function png(size, hex) {
  const r = parseInt(hex.slice(0, 2), 16)
  const g = parseInt(hex.slice(2, 4), 16)
  const b = parseInt(hex.slice(4, 6), 16)
  const row = Buffer.alloc(1 + size * 3)
  for (let x = 0; x < size; x++) {
    row[1 + x * 3] = r
    row[2 + x * 3] = g
    row[3 + x * 3] = b
  }
  const raw = Buffer.concat(Array.from({ length: size }, () => row))
  const idat = zlib.deflateSync(raw)
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

  function chunk(type, data) {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length, 0)
    const t = Buffer.from(type, 'ascii')
    const crcTable = []
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
    let crc = 0xffffffff
    for (const b of Buffer.concat([t, data])) crc = crcTable[(crc ^ b) & 0xff] ^ (crc >>> 8)
    const crcBuf = Buffer.alloc(4)
    crcBuf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 0)
    return Buffer.concat([len, t, data, crcBuf])
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

fs.mkdirSync('public', { recursive: true })
fs.writeFileSync('public/icon-192.png', png(192, '4f7cff'))
fs.writeFileSync('public/icon-512.png', png(512, '4f7cff'))
console.log('icon-192:', fs.statSync('public/icon-192.png').size, 'bytes')
console.log('icon-512:', fs.statSync('public/icon-512.png').size, 'bytes')
