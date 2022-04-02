const request = require('request');
const sharp = require('sharp');

export default function nearspark(query, params, callback) {
  const {
    w,
    h,
    fit,
    position,
    gravity,
    strategy,
    background,
    withoutEnlargement,
  } = query;
  let base64url = params.url;

  // Drop extension, if present (for compatibility with imgproxy,
  // which has extension passed for CDN caching)
  if (base64url.includes('.')) {
    base64url = base64url.substring(0, base64url.indexOf('.'));
  }

  const url = decodeURIComponent(Buffer.from(base64url, 'base64').toString());
  const sharpFit = fit || 'cover';

  let sharpPosition = sharp.position.centre;

  if (position) {
    sharpPosition = sharp.position[position];
  } else if (gravity) {
    sharpPosition = sharp.gravity[gravity];
  } else if (strategy) {
    sharpPosition = sharp.strategy[strategy];
  }

  const sharpBackground = background || {
    r: 0, g: 0, b: 0, alpha: 1,
  };

  request.get({ url, encoding: null }, (_, __, body) => {
    sharp(body)
      .resize({
        width: parseInt(w, 10),
        height: parseInt(h, 10),
        fit: sharpFit,
        position: sharpPosition,
        background: sharpBackground,
        withoutEnlargement: withoutEnlargement === 'true',
      })
      .withMetadata()
      .toBuffer({ resolveWithObject: true })
      .then(({ data, info }) => {
        const headers = {
          'Content-Type': `image/${info.format}`,
          'Cache-Control': 'max-age=86400',
        };

        callback({
          statusCode: 200,
          body: data.toString('base64'),
          isBase64Encoded: true,
          headers,
        });
      });
  });
}
