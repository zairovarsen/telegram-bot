

import { Buffer} from 'buffer';


export class FileLikeBuffer extends Buffer {
  data: Buffer;
  name: string;
  size: number;
  type: string;

  constructor(data: Buffer, name: string, type: string) {
    super(data);
    this.data = data;
    this.name = name;
    this.size = data.length;
    this.type = type;
  }

  arrayBuffer(): Promise<ArrayBuffer> {
    return new Promise((resolve) => {
      resolve(this.data.buffer);
    });
  }
}