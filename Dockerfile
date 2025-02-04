# Usa una imagen base oficial de Node.js
FROM node:18-alpine

# Establece el directorio de trabajo
WORKDIR /app

# Copia package.json y package-lock.json (o yarn.lock)
COPY package*.json ./

# Instala las dependencias
RUN npm install --production

# Copia el resto del código
COPY . .

# Compila el proyecto (si usas TypeScript, por ejemplo)
RUN npm run build

# Expone el puerto en el que corre la app
EXPOSE 3000

# Inicia la aplicación
CMD ["node", "dist/main.js"]
