declare module 'write-file-atomic' {
  import type { WriteFileOptions } from 'node:fs';

  function writeFileAtomic(
    filename: string,
    data: string | Buffer,
    options?: WriteFileOptions | string,
  ): Promise<void>;

  export default writeFileAtomic;
}
