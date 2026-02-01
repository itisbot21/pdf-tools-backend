FROM node:18-bullseye

# Install system dependencies for PDF tools
RUN apt-get update && apt-get install -y \
    poppler-utils \
    ghostscript \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy dependency files first (better caching)
COPY package*.json ./

RUN npm install --production

# Copy the rest of the app
COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
