const express = require('express');
const { chromium } = require('playwright');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3000;

app.get('/api/extract', async (req, res) => {
  const { type = 'movie', id, season = '1', episode = '1' } = req.query;

  if (!id) {
    return res.status(400).json({ success: false, error: 'TMDB or MAL ID parameter required' });
  }

  let embedUrl = `https://vidlink.pro/${type}/${id}`;
  if (type === 'tv') {
    embedUrl += `/${season}/${episode}`;
  }

  let browser = null;

  try {
    console.log(`[+] [${new Date().toISOString()}] Intercepting: ${embedUrl}`);

    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote'
      ]
    });

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 720 }
    });

    const page = await context.newPage();
    let detectedStreamUrl = null;

    page.on('request', (request) => {
      const url = request.url();
      if ((url.includes('.m3u8') || url.includes('/playlist/') || url.includes('/hls/')) && !detectedStreamUrl) {
        console.log(`[!] Captured Stream: ${url}`);
        detectedStreamUrl = url;
      }
    });

    await page.goto(embedUrl, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForTimeout(3000);

    if (!detectedStreamUrl) {
      try {
        const playBtn = page.locator('video, button, div[class*="play"]').first();
        if (await playBtn.isVisible()) {
          await playBtn.click({ force: true });
          await page.waitForTimeout(3000);
        }
      } catch (e) {}
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
      return res.status(404).json({ success: false, error: 'Stream not detected or protected.' });
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
