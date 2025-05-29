# Базовый образ с Node.js
FROM node:18-alpine

WORKDIR /app

# Копируем файлы фронтенда
COPY src ./src

# Создаем package.json для установки Tailwind CSS
# RUN echo '{"dependencies": {"tailwindcss": "^3.4.1"}}' > package.json && \
#     npm install && \
#     npx tailwindcss -i ./src/input.css -o ./src/dist/output.css || { echo "Tailwind CSS build failed"; exit 1; }

# Копируем серверный код
COPY server ./server

# Устанавливаем зависимости для сервера
WORKDIR /app/server
RUN npm install

# Открываем порт для Node.js
EXPOSE 3000

# Запускаем Node.js сервер
CMD ["node", "server.js"]