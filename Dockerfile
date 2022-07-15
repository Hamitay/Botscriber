# Builder stage
FROM node:16-alpine3.11 as ts-builder

WORKDIR /app
COPY package.* ./
COPY tsconfig.json ./

ADD ./prisma prisma
ADD ./src src

RUN npm install
RUN npx prisma generate

RUN npm run build

# Runner stage
FROM node:16-alpine3.11 as ts-runner
WORKDIR  /app
COPY --from=ts-builder ./app/bin ./bin
COPY --from=ts-builder ./app/prisma ./bin/prisma
COPY --from=ts-builder ./app/node_modules ./bin/node_modules

CMD ["node", "bin/app.js"]