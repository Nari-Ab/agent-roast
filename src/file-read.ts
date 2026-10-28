import * as fs from "fs";

/** Bounded policy/data read: reject links, devices and FIFOs before opening. */
export function readRegularFile(filename: string, limit: number): Buffer {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > limit) throw new Error(`Expected a regular file no larger than ${limit} bytes.`);
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0) | (fs.constants.O_NONBLOCK || 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!opened.isFile() || opened.ino !== stat.ino || opened.dev !== stat.dev) throw new Error("File changed while opening.");
    const buffer = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!read) break;
      size += read;
    }
    const after = fs.fstatSync(fd);
    if (size > limit || size !== after.size || opened.size !== after.size || opened.mtimeMs !== after.mtimeMs || opened.ctimeMs !== after.ctimeMs) {
      throw new Error("File changed or exceeded the read limit.");
    }
    return buffer.subarray(0, size);
  } finally { fs.closeSync(fd); }
}
