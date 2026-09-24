const express = require('express');
const { chromium } = require('playwright');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 10000;

/**
 * Helper to launch Playwright with optional proxy configuration
 */
async function launchBrowser() {
  const launchOptions = {
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  };

  // Attach Proxy if provided via environment variables (required for datacenter hosts like Render)
  if (process.env.PROXY_SERVER) {
    launchOptions.proxy = {
      server: process.env.PROXY_SERVER
    };
    if (process.env.PROXY_USERNAME && process.env.PROXY_PASSWORD) {
      launchOptions.proxy.username = process.env.PROXY_USERNAME;
      launchOptions.proxy.password = process.env.PROXY_PASSWORD;
    }
    console.log(`[*] Using configured proxy: ${process.env.PROXY_SERVER}`);
  }

  return await chromium.launch(launchOptions);
}

/**
 * 1. Stream Interceptor API Endpoint
 */
app.get('/api/extract', async (req, res) => {
  const { url, type = 'movie', id, season = '1', episode = '1' } = req.query;

  let targetUrl = url;
  if (!targetUrl) {
    if (!id) {
      return res.status(400).json({ success: false, error: 'Provide a target URL or media ID' });
    }
    targetUrl = `https://vidlink.pro/${type}/${id}${type === 'tv' ? `/${season}/${episode}` : ''}?autoplay=true`;
  }

  let browser = null;

  try {
    console.log(`[+] [${new Date().toISOString()}] Intercepting target: ${targetUrl}`);

    browser = await launchBrowser();

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    let detectedStreamUrl = null;

    // Listen to network request traffic
    page.on('request', (request) => {
      const reqUrl = request.url();
      if ((reqUrl.includes('.m3u8') || reqUrl.includes('/playlist/') || reqUrl.includes('/hls/')) && !detectedStreamUrl) {
        console.log(`[!] Captured Stream Request: ${reqUrl}`);
        detectedStreamUrl = reqUrl;
      }
    });

    // Listen to network response headers
    page.on('response', (response) => {
      if (detectedStreamUrl) return;
      const contentType = response.headers()['content-type'] || '';
      if (contentType.includes('mpegurl') || contentType.includes('x-mpegurl')) {
        console.log(`[!] Captured Stream Response: ${response.url()}`);
        detectedStreamUrl = response.url();
      }
    });

    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // Fallback interaction if stream isn't triggered automatically
    if (!detectedStreamUrl) {
      const playBtn = page.locator('video, button, div[class*="play"]').first();
      if (await playBtn.isVisible().catch(() => false)) {
        await playBtn.click({ force: true }).catch(() => {});
        await page.waitForTimeout(3000);
      }
    }

    await browser.close();
    browser = null;

    if (detectedStreamUrl) {
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'http';
      const proxiedStreamUrl = `${protocol}://${host}/api/proxy?url=${encodeURIComponent(detectedStreamUrl)}`;

      return res.json({
        success: true,
        stream: {
          raw: detectedStreamUrl,
          proxied: proxiedStreamUrl,
          format: 'hls'
        }
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'Stream not detected. Render datacenter IPs are blocked by Cloudflare WAF. Please add a PROXY_SERVER environment variable in Render settings.'
      });
    }

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * 2. CORS & Manifest Proxy Endpoint
 */
app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).send('Missing url parameter');

  try {
    const targetUrl = decodeURIComponent(url);

    const axiosOptions = {
      method: 'GET',
      url: targetUrl,
      headers: {
        'Referer': 'https://vidlink.pro/',
        'Origin': 'https://vidlink.pro',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      responseType: 'arraybuffer',
      timeout: 15000,
      validateStatus: () => true
    };

    const response = await axios(axiosOptions);

    const contentType = response.headers['content-type'] || 'application/vnd.apple.mpegurl';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (contentType.includes('mpegurl') || targetUrl.includes('.m3u8')) {
      let manifestText = response.data.toString('utf-8');
      const baseUrl = targetUrl.substring(0, targetUrl.lastIndexOf('/') + 1);
      const host = req.headers.host;
      const protocol = req.headers['x-forwarded-proto'] || 'http';

      const rewrittenManifest = manifestText.replace(/^(?!#)(.+)$/gm, (line) => {
        const trimmed = line.trim();
        if (!trimmed) return line;
        const absUrl = trimmed.startsWith('http') ? trimmed : `${baseUrl}${trimmed}`;
        return `${protocol}://${host}/api/proxy?url=${encodeURIComponent(absUrl)}`;
      });

      return res.status(200).send(rewrittenManifest);
    }

    return res.status(response.status).send(response.data);

  } catch (err) {
    return res.status(500).send(`Proxy Error: ${err.message}`);
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
