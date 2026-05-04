# Backend Dockerfile
#FROM node:18-alpine

# Set working directory
#WORKDIR /app

# Copy package files
#COPY package*.json ./

# Install dependencies
#RUN npm install --production

# Copy source code
#COPY . .

# Expose port
#EXPOSE 3001

# Set environment to production
#ENV NODE_ENV=production

# Start server
#CMD ["npm", "start"]





FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

# Install ALL deps (needed for build)
RUN npm install

COPY . .

# Expose port
EXPOSE 3001

# 🔥 Build TypeScript
RUN npm run build

# Optional: remove dev deps to reduce size
RUN npm prune --production

CMD ["npm", "start"]
