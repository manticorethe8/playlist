# Stream Extractor & CORS Proxy Service

Updated codebase supporting environment-based proxy routing for hosting platforms like Render.

## Why Proxies Are Required on Render
Render's servers run on AWS cloud datacenter IP ranges. Security systems like Cloudflare WAF block cloud datacenter IPs by default. To extract streams from Cloudflare-protected sites while hosted on Render, you must configure a residential proxy.

## Setting Up Proxy in Render
1. Go to your Render Dashboard -> **Environment**.
2. Add the following environment variables:
   - `PROXY_SERVER`: `http://your-proxy-host:port` (e.g., `http://p.webshare.io:8080`)
   - `PROXY_USERNAME`: `your_username` (optional)
   - `PROXY_PASSWORD`: `your_password` (optional)
3. Save changes. Render will restart the service with proxy support enabled.
