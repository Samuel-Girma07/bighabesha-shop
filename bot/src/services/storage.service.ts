import {
  S3Client,
  PutObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  type ListObjectsV2CommandOutput,
  type GetObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import { getConfig } from '../config/env.js';
import { resolveReceiptsDir } from './receipts.service.js';
import { logger } from '../logger/index.js';

let s3ClientInstance: S3Client | null = null;

export function getS3Client(): S3Client | null {
  const config = getConfig();
  if (!config.B2_BUCKET || !config.B2_KEY_ID || !config.B2_APPLICATION_KEY || !config.B2_ENDPOINT) {
    return null;
  }
  if (!s3ClientInstance) {
    let endpoint = config.B2_ENDPOINT;
    if (!endpoint.startsWith('http://') && !endpoint.startsWith('https://')) {
      endpoint = `https://${endpoint}`;
    }
    const region =
      config.B2_REGION ||
      (config.B2_ENDPOINT.match(/s3\.([a-z0-9-]+)\.backblazeb2\.com/)?.[1]) ||
      'us-east-1';

    s3ClientInstance = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId: config.B2_KEY_ID,
        secretAccessKey: config.B2_APPLICATION_KEY,
      },
      forcePathStyle: true,
    });
  }
  return s3ClientInstance;
}

export function isRemoteStorageConfigured(): boolean {
  return getS3Client() !== null;
}

export async function uploadReceiptToRemote(
  filename: string,
  buffer: Buffer,
  contentType: string = 'image/jpeg'
): Promise<boolean> {
  const client = getS3Client();
  const config = getConfig();
  if (!client || !config.B2_BUCKET) return false;

  try {
    const key = `receipts/${filename}`;
    await client.send(
      new PutObjectCommand({
        Bucket: config.B2_BUCKET,
        Key: key,
        Body: buffer,
        ContentType: contentType,
      })
    );
    logger.info({ filename, bucket: config.B2_BUCKET }, 'Receipt successfully uploaded to Backblaze B2');
    return true;
  } catch (err) {
    logger.error({ err, filename }, 'Failed to upload receipt to Backblaze B2');
    return false;
  }
}

export async function syncReceiptsFromRemote(): Promise<number> {
  const client = getS3Client();
  const config = getConfig();
  if (!client || !config.B2_BUCKET) return 0;

  try {
    const receiptsDir = resolveReceiptsDir();
    await fsp.mkdir(receiptsDir, { recursive: true });

    logger.info({ bucket: config.B2_BUCKET, dir: receiptsDir }, 'Checking Backblaze B2 for existing receipts...');
    let continuationToken: string | undefined = undefined;
    let syncedCount = 0;

    do {
      const resp: ListObjectsV2CommandOutput = await client.send(
        new ListObjectsV2Command({
          Bucket: config.B2_BUCKET,
          Prefix: 'receipts/',
          ContinuationToken: continuationToken,
        })
      );

      if (resp.Contents) {
        for (const item of resp.Contents) {
          if (!item.Key || item.Key.endsWith('/')) continue;
          const filename = path.basename(item.Key);
          const targetPath = path.join(receiptsDir, filename);

          if (!fs.existsSync(targetPath)) {
            try {
              const getObj: GetObjectCommandOutput = await client.send(
                new GetObjectCommand({
                  Bucket: config.B2_BUCKET,
                  Key: item.Key,
                })
              );

              if (getObj.Body) {
                const stream = getObj.Body as Readable;
                const chunks: Buffer[] = [];
                for await (const chunk of stream) {
                  chunks.push(Buffer.from(chunk));
                }
                const buffer = Buffer.concat(chunks);
                await fsp.writeFile(targetPath, buffer);
                syncedCount++;
              }
            } catch (dlErr) {
              logger.warn({ err: dlErr, key: item.Key }, 'Failed to download receipt from Backblaze B2');
            }
          }
        }
      }

      continuationToken = resp.NextContinuationToken;
    } while (continuationToken);

    if (syncedCount > 0) {
      logger.info({ count: syncedCount }, 'Receipts successfully synced from Backblaze B2 to local container');
    }
    return syncedCount;
  } catch (err) {
    logger.warn({ err }, 'Error while syncing receipts from Backblaze B2');
    return 0;
  }
}
