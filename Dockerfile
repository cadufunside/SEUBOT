
FROM node:18-bullseye

ENV PUPPETEER_SKIP_DOWNLOAD=true

RUN apt-get update && apt-get install -y   chromium   ca-certificates   fonts-liberation   libatk-bridge2.0-0   libnss3   libx11-6   libx11-xcb1   libxcomposite1   libxcursor1   libxdamage1   libxi6   libxtst6   libdrm2   libxrandr2   libasound2   libpango-1.0-0   libgbm1   libatk1.0-0   libcups2   libxss1   libgtk-3-0   wget && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .

ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=3000
EXPOSE 3000
CMD ["npm","start"]
