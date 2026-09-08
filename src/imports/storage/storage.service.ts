import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as fs from 'fs';
import * as path from 'path';
import { Readable } from 'stream';

export interface StorageProvider {
  save(filename: string, buffer: Buffer): Promise<string>;
  getStream(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
}

@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly uploadDir: string;

  constructor(private readonly configService: ConfigService) {
    this.uploadDir = path.resolve(process.cwd(), 'uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async saveFile(filename: string, buffer: Buffer): Promise<string> {
    const sanitizedFilename = `${Date.now()}_${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const filePath = path.join(this.uploadDir, sanitizedFilename);
    await fs.promises.writeFile(filePath, buffer);
    this.logger.log(`Stored upload file locally at: ${filePath}`);
    return sanitizedFilename;
  }

  getFilePath(key: string): string {
    const filePath = path.join(this.uploadDir, path.basename(key));
    if (!fs.existsSync(filePath)) {
      throw new Error(`File not found in storage: ${key}`);
    }
    return filePath;
  }

  async getFileStream(key: string): Promise<Readable> {
    const filePath = this.getFilePath(key);
    return fs.createReadStream(filePath);
  }

  async deleteFile(key: string): Promise<void> {
    const filePath = path.join(this.uploadDir, path.basename(key));
    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
      this.logger.log(`Deleted storage file: ${key}`);
    }
  }
}
