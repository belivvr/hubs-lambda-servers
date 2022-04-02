/* eslint-disable no-shadow */
/* eslint-disable no-console */
/* eslint-disable no-promise-executor-return */
/* eslint-disable no-await-in-loop */

import chromium from 'chrome-aws-lambda';
import Cdp from 'chrome-remote-interface';
import { spawn } from 'child_process';

import urlAllowed from './url-utils';

function sleep(milliseconds = 100) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function screenshot(url, fullscreen) {
  let data;
  let meta;
  let loaded = false;

  const loading = async (startTime = Date.now()) => {
    if (!loaded && Date.now() - startTime < 12 * 1000) {
      await sleep(100);
      await loading(startTime);
    }
  };
  const options = chromium.args.concat([
    '--remote-debugging-port=9222',
    '--window-size=1280x720',
    '--hide-scrollbars',
  ]);

  const path = await chromium.executablePath;
  const chrome = spawn(path, options);
  chrome.stdout.on('data', (data) => console.log(data.toString()));
  chrome.stderr.on('data', (data) => console.log(data.toString()));

  let client;
  let clientIsAvailable = false;

  for (let i = 0; i < 20; i += 1) {
    try {
      client = await Cdp();
      if (client) {
        clientIsAvailable = true;
        break;
      } else {
        await sleep(100);
      }
    } catch (e) {
      console.log(e);
      await sleep(500);
    }
  }

  const {
    Network, Page, Runtime, Emulation, Fetch,
  } = client;

  try {
    await Promise.all([Network.enable(), Page.enable(), Fetch.enable()]);

    // This uses the request interception API to reject or allow requests
    // https://chromedevtools.github.io/devtools-protocol/tot/Fetch/#event-requestPaused
    Fetch.requestPaused(async (event) => {
      if (await urlAllowed(event.request.url)) {
        if (clientIsAvailable) {
          Fetch.continueRequest({ requestId: event.requestId });
        }
      } else if (clientIsAvailable) {
        Fetch.failRequest({
          requestId: event.requestId,
          errorReason: 'AccessDenied',
        });
      }
    });

    await Emulation.setDeviceMetricsOverride({
      mobile: false,
      deviceScaleFactor: 0,
      scale: 1,
      width: 1280,
      height: 0,
    });

    await Page.loadEventFired(() => {
      loaded = true;
    });
    await Page.navigate({ url });
    await loading();

    let height = 720;

    if (fullscreen) {
      const result = await Runtime.evaluate({
        expression: `(
          () => ({ height: document.body.scrollHeight })
        )();
        `,
        returnByValue: true,
      });

      height = result.result.value.height;
    }

    await Emulation.setDeviceMetricsOverride({
      mobile: false,
      deviceScaleFactor: 0,
      scale: 1,
      width: 1280,
      height,
    });

    // Look for a global function _photomnemonicReady and if it exists, wait until it returns true.
    await Runtime.evaluate({
      expression: `new Promise(resolve => {
        if (window._photomnemonicReady) {
          if (window._photomnemonicReady()) {
            resolve();
          } else {
            const interval = setInterval(() => {
              if (window._photomnemonicReady()) {
                clearInterval(interval);
                resolve();
              }
            }, 250)
          }
        } else {
          resolve();
        }
      })`,
      awaitPromise: true,
    });

    const metaResult = await Runtime.evaluate({
      expression: 'window._photomnemonicGetMeta ? window._photomnemonicGetMeta() : null',
      returnByValue: true,
    });

    if (metaResult.result.value) {
      meta = metaResult.result.value;
    }

    await Emulation.setVisibleSize({
      width: meta && meta.width ? meta.width : 1280,
      height: meta && meta.height ? meta.height : height,
    });

    const screenshot = await Page.captureScreenshot({ format: 'png' });
    data = screenshot.data;
  } catch (error) {
    console.error(error);
  }

  clientIsAvailable = false;
  chrome.kill();
  await client.close();

  return { data, meta };
}

export default async function handler(event, callback) {
  const queryStringParameters = event.queryStringParameters || {};
  const { url = 'https://www.mozilla.org', fullscreen = 'false' } = queryStringParameters;

  if (!(await urlAllowed(url))) {
    return callback(null, { statusCode: 403, body: 'forbidden' });
  }

  let data;

  const headers = {
    'Content-Type': 'image/png',
  };

  try {
    const result = await screenshot(url, fullscreen === 'true');
    data = result.data;

    if (result.meta) {
      headers['X-Photomnemonic-Meta'] = JSON.stringify(result.meta);
    }
  } catch (error) {
    console.error('Error capturing screenshot for', url, error);
    return callback(error);
  }

  return callback(null, {
    statusCode: 200,
    body: data,
    isBase64Encoded: true,
    headers,
  });
}
