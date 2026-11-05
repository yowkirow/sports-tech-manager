import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
    define: {
        // Must match PRINT_QUEUE_ENABLED in wrangler.production.jsonc (enabled 2026-10-13).
        'import.meta.env.VITE_PRINT_QUEUE_ENABLED': JSON.stringify(mode === 'staging' ? 'true' : process.env.VITE_PRINT_QUEUE_ENABLED || 'true'),
        // The shop's Meta Pixel ("Sports TECH Event Data", owner-approved 2026-11-05). A Pixel ID is
        // public by design: every page that loads the Pixel shows it. Staging builds leave it out.
        'import.meta.env.VITE_META_PIXEL_ID': JSON.stringify(mode === 'staging' ? '' : process.env.VITE_META_PIXEL_ID ?? '1659409512144130')
    },
    plugins: [
        react(),
        VitePWA({
            registerType: 'autoUpdate',
            workbox: {
                // The service worker precaches the app's files but never answers a page load: every visit
                // gets the page from the Worker and so runs the current release. (Serving its saved
                // index.html kept returning visitors on the previous release for a whole visit after each
                // deploy, 2026-11-05.) index.html stays out of the precache too, or Workbox would still
                // answer "/" from it as the directory index.
                navigateFallback: null,
                globIgnores: ['**/node_modules/**/*', 'index.html']
            },
            includeAssets: ['icon-192.png', 'apple-touch-icon.png'],
            manifest: {
                name: 'SportsTech Manager',
                short_name: 'SportsTech',
                description: 'SportsTech Business Manager',
                theme_color: '#ef4444',
                background_color: '#0b0b0c',
                display: 'standalone',
                scope: '/',
                start_url: '/admin',
                orientation: 'portrait',
                icons: [
                    {
                        src: 'icon-192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'icon-512.png',
                        sizes: '512x512',
                        type: 'image/png'
                    },
                    {
                        src: 'icon-maskable-512.png',
                        sizes: '512x512',
                        type: 'image/png',
                        purpose: 'maskable'
                    }
                ]
            }
        })
    ],
}))
