FROM mcr.microsoft.com/playwright:v1.44.0-jammy

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install exact production dependencies matching Docker Playwright version
RUN npm install --production

COPY . .

ENV PORT=3000
EXPOSE 3000

CMD ["node", "server.js"]
