# Etapa 1: Construcción
FROM node:18-alpine AS builder

# Establece el directorio de trabajo
WORKDIR /app

# Copia los archivos de dependencias
COPY package*.json ./

# Instala todas las dependencias (incluyendo devDependencies)
RUN npm install

# Copia el resto del código
COPY . .

# Compila el proyecto
RUN npm run build

# Etapa 2: Imagen de producción
FROM node:18-alpine

# Establece el directorio de trabajo
WORKDIR /app

# Copia solo package.json y package-lock.json (o yarn.lock)
COPY package*.json ./

# Instala únicamente las dependencias de producción
RUN npm install --production

# Copia los archivos compilados desde la etapa builder
COPY --from=builder /app/dist ./dist

# Expone el puerto en el que corre la aplicación
EXPOSE 3000

# Inicia la aplicación
CMD ["node", "dist/main.js"]
