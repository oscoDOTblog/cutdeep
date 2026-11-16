FROM node:20-slim
WORKDIR /srv/web
COPY package.json ./
RUN npm install
COPY . ./
RUN npm run build
ENV FP_API_URL=http://fp-api:8000
EXPOSE 3000
CMD ["npm", "start"]
