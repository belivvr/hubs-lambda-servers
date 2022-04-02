import { join } from 'path';
import { tmpdir } from 'os';
import { spawn } from 'child_process';
import {
  unlink,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
} from 'fs';

import AWS from 'aws-sdk';

process.env.PATH = `${process.env.PATH}:${process.env.LAMBDA_TASK_ROOT}`;

// Shamelessly taken from https://gist.github.com/6174/6062387
const createKey = () => Math.random()
  .toString(36)
  .substring(2, 15)
  + Math.random()
    .toString(36)
    .substring(2, 15);

const { log } = console;

const tempDir = process.env.TEMP || tmpdir();
const tempFile = join(tempDir, 'tempFile');
const outputDir = join(tempDir, 'tempOutput');

if (!existsSync(outputDir)) mkdirSync(outputDir);

function ffmpeg(ffmpegArgs, destFile) {
  log('Starting FFmpeg');

  return new Promise((resolve, reject) => {
    const args = ['-y', '-loglevel', 'warning', '-i', tempFile, ...ffmpegArgs.split(' '), destFile];

    log(args);

    spawn('ffmpeg', args, {})
      .on('message', (msg) => log(msg))
      .on('error', reject)
      .on('close', resolve);
  });
}

function removeFile(localFilePath) {
  log(`Deleting ${localFilePath}`);

  return new Promise((resolve, reject) => {
    unlink(localFilePath, (err, result) => (err ? reject(err) : resolve(result)));
  });
}

// Perform a GET to /init to get a upload URL and key to pass to convert for conversion
export async function init(callback) {
  const { scratchBucketId, scratchBucketRegion } = process.env;
  const key = createKey();

  const s3 = new AWS.S3({
    region: scratchBucketRegion,
    signatureVersion: 'v4',
  });

  const uploadUrl = s3.getSignedUrl('putObject', {
    Bucket: scratchBucketId,
    Key: key,
    Expires: 240,
  });

  return callback(null, {
    statusCode: 200,
    body: JSON.stringify({ uploadUrl, key }),
    isBase64Encoded: false,
  });
}

export async function convert(event, callback) {
  const queryStringParameters = event.queryStringParameters || {};

  const { scratchBucketId, scratchBucketRegion } = process.env;
  const s3 = new AWS.S3({
    region: scratchBucketRegion,
    signatureVersion: 'v4',
  });

  const sourceKey = queryStringParameters.key;
  const ffmpegArgs = queryStringParameters.args;

  const destKey = createKey();

  await new Promise((resolve, reject) => {
    s3.getObject({ Bucket: scratchBucketId, Key: sourceKey })
      .on('error', (error) => reject(new Error(`S3 Download Error: ${error}`)))
      .createReadStream()
      .on('end', () => {
        log('Download finished');
        resolve();
      })
      .on('error', reject)
      .pipe(createWriteStream(tempFile));
  });

  const destFullPath = join(outputDir, destKey);

  // await ffprobe();
  await ffmpeg(ffmpegArgs, destFullPath);
  await removeFile(tempFile);

  const fileStream = createReadStream(destFullPath);
  const uploadConfig = {
    Bucket: scratchBucketId,
    Key: destKey,
    Body: fileStream,
    ACL: 'public-read',
  };

  log(uploadConfig);

  await s3.putObject(uploadConfig).promise();

  removeFile(destFullPath);

  return callback(null, {
    statusCode: 200,
    body: JSON.stringify({
      url:
        scratchBucketRegion === 'us-east-1'
          ? `https://${scratchBucketId}.s3.amazonaws.com/${destKey}`
          : `https://${scratchBucketId}.s3-${scratchBucketRegion}.amazonaws.com/${destKey}`,
    }),
    isBase64Encoded: false,
  });
}
