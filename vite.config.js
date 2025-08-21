import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// REEMPLAZÁ 'inventario-henko-web' por el nombre de tu repositorio
export default defineConfig({
  plugins: [react()],
  base: '/inventario-henko-web/',
})
