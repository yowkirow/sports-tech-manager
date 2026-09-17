import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    define: {
        'import.meta.env.VITE_PRINT_QUEUE_ENABLED': JSON.stringify(mode === 'staging' ? 'true' : process.env.VITE_PRINT_QUEUE_ENABLED || 'false')
    },
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            workbox: {
                navigateFallbackDenylist: [/^\/api\//, /^\/cdn-cgi\//, /^\/admin(?:\/|$)/, /^\/print(?:\/|$)/, /^\/health$/]
            },
            includeAssets: ['favicon.ico', 'apple-touch-icon.png', 'masked-icon.svg'],
            manifest: {
                name: 'SportsTech Manager',
                short_name: 'SportsTech',
                description: 'SportsTech Business Manager',
                theme_color: '#ef4444',
                background_color: '#0f172a',
                display: 'standalone',
                scope: '/',
                start_url: '/admin',
                orientation: 'portrait',
                icons: [
                    {
                        src: 'logo.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'logo.png',
                        sizes: '512x512',
                        type: 'image/png'
                    }
                ]
            }
        })
    ],
}))
