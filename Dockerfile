
FROM node:18-slim
ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/google-chrome-stable
RUN apt-get update && apt-get install -y wget gnupg ca-certificates \
    && mkdir -p /usr/share/keyrings \
    && wget -qO- https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor > /usr/share/keyrings/google-linux.gpg \
    && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/google-linux.gpg] http://dl.google.com/linux/chrome/deb/ stable main" > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y google-chrome-stable \
    && apt-get clean && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json /app/
RUN npm install --production
COPY . /app
EXPOSE 3000
CMD ["npm","start"]
