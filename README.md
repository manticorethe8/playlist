# VidLink VPS Stream Extractor & Proxy Service

Complete self-hosted solution designed for **Oracle Cloud Always Free VPS** or Docker hosting environments.

## Why Oracle Cloud VPS is the Best Choice
1. **Zero Sleep Mode:** Free platforms like Render go to sleep after 15 minutes of inactivity, causing 30-50s delays for your users. Oracle Cloud runs 24/7.
2. **No RAM Crash Risk:** Headless Chromium requires ~300-400MB RAM per instance. Render/Koyeb capped at 512MB RAM crash under simultaneous users. Oracle Cloud provides up to 24GB RAM for free.
3. **No Execution Limits:** Serverless function limits (10-15s) cause high failure rates during slow stream decryption. A VPS has no execution timeouts.

---

## Deploying on Oracle Cloud Ubuntu VPS (Recommended)

### Step 1: Connect to your VPS via SSH
```bash
ssh ubuntu@YOUR_VPS_IP
```

### Step 2: Install Docker & Docker Compose
```bash
sudo apt update && sudo apt install -y docker.io docker-compose
sudo systemctl enable --now docker
```

### Step 3: Unzip and Launch Service
```bash
# Upload and unzip vidlink-extractor-vps.zip
unzip vidlink-extractor-vps.zip
cd vidlink-extractor-vps

# Start container in detached background mode
sudo docker-compose up -d --build
```

### Step 4: Test Your Endpoint
Open `http://YOUR_VPS_IP:3000/` in your browser.
