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

app.get('/api/extract', async (req, res) => {
  const { type = 'movie', id, season = '1', episode = '1' } = req.query;

  if (!id) {
    return res.status(400).json({ success: false, error: 'TMDB ID required' });
  }

  let embedUrl = `https://vidlink.pro/${type}/${id}`;
  if (type === 'tv') {
    embedUrl += `/${season}/${episode}`;
  }
  embedUrl += '?autoplay=true';

  let browser = null;

  try {
    console.log(`[+] Intercepting VidLink: ${embedUrl}`);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--use-gl=swiftshader'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 1,
      isMobile: false,
      hasTouch: false,
      locale: 'en-US',
      timezoneId: 'America/New_York'
    });

    const page = await context.newPage();

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
      Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] });
    });

    let detectedStreamUrl = null;

    page.on('request', (request) => {
      const url = request.url();
      if ((url.includes('.m3u8') || url.includes('/playlist/') || url.includes('/hls/') || url.includes('.mpd')) && !detectedStreamUrl) {
        console.log(`[!] Captured Stream Request: ${url}`);
        detectedStreamUrl = url;
      }
    });

    page.on('response', async (response) => {
      if (detectedStreamUrl) return;
      const url = response.url();
      const contentType = response.headers()['content-type'] || '';

      if (contentType.includes('mpegurl') || contentType.includes('x-mpegurl') || contentType.includes('vnd.apple.mpegurl')) {
        console.log(`[!] Captured Stream Content-Type: ${url}`);
        detectedStreamUrl = url;
      }
    });

    await page.goto(embedUrl, { waitUntil: 'load', timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(4000);

    if (!detectedStreamUrl) {
      console.log('[*] Attempting player click interactions...');
      const mainPlay = page.locator('video, button, iframe, div[class*="play"], div[class*="player"]').first();
      if (await mainPlay.isVisible().catch(() => false)) {
        await mainPlay.click({ force: true }).catch(() => {});
        await page.waitForTimeout(3000);
      }

      for (const frame of page.frames()) {
        if (detectedStreamUrl) break;
        try {
          const framePlay = frame.locator('video, button, div[class*="play"]').first();
          if (await framePlay.isVisible().catch(() => false)) {
            await framePlay.click({ force: true }).catch(() => {});
            await page.waitForTimeout(2000);
          }
        } catch (e) {}
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
        media: { type, id, season: type === 'tv' ? season : undefined, episode: type === 'tv' ? episode : undefined },
        stream: {
          raw: detectedStreamUrl,
          proxied: proxiedStreamUrl,
          format: 'hls'
        }
      });
    } else {
      return res.status(404).json({
        success: false,
        error: 'Stream link not detected. VidLink may be blocking datacenter IPs or requiring manual Cloudflare verification.'
      });
    }

  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    return res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/proxy', async (req, res) => {
  const { url } = req.query;

  if (!url) return res.status(400).send('Missing url parameter');

  try {
    const targetUrl = decodeURIComponent(url);

    const response = await axios({
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
    });

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
