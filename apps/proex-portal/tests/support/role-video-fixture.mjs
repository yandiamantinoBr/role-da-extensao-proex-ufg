function box(type, ...parts) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(8 + parts.reduce((sum, part) => sum + part.length, 0));
  header.write(type, 4, 'ascii');
  return Buffer.concat([header, ...parts]);
}

function ticks(timescale, duration) {
  const header = Buffer.alloc(20);
  header.writeUInt32BE(timescale, 12);
  header.writeUInt32BE(duration, 16);
  return header;
}

function track(kind, seconds, sampleSeconds = seconds) {
  const header = Buffer.alloc(24);
  header.writeUInt32BE(seconds * 1000, 20);
  const handler = Buffer.alloc(12);
  handler.write(kind, 8, 'ascii');
  const samples = Buffer.alloc(16);
  samples.writeUInt32BE(1, 4); // one sample-duration entry
  samples.writeUInt32BE(10, 8);
  samples.writeUInt32BE(sampleSeconds * 100, 12);
  const info = box('minf', box('stbl', box('stts', samples)));
  const media = box('mdia', box('mdhd', ticks(1000, seconds * 1000)), box('hdlr', handler), info);
  return box('trak', box('tkhd', header), media);
}

export function roleVideoFixture({ seconds = 4, sampleSeconds = seconds, kind = 'vide', fragmented = false } = {}) {
  const ftyp = box('ftyp', Buffer.from('isom\0\0\0\0isom'));
  const moov = box('moov', box('mvhd', ticks(1000, seconds * 1000)), track(kind, seconds, sampleSeconds));
  const chunks = [ftyp, moov, box('mdat', Buffer.from('video sample marker'))];
  if (fragmented) chunks.push(box('moof'));
  return 'data:video/mp4;base64,' + Buffer.concat(chunks).toString('base64');
}
