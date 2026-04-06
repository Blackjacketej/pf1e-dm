import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  // Set base for GitHub Pages — change 'pf1e-dm' to your repo name
  base: process.env.GITHUB_PAGES ? '/pf1e-dm/' : '/',
  plugins: [react()],
  // Use OS temp dir for Vite cache to avoid OneDrive locking issues
  cacheDir: process.env.TEMP
    ? `${process.env.TEMP}/vite-pf-dm`
    : 'node_modules/.vite',
  server: {
    open: true,
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'data-monsters': ['./src/data/monsters.json'],
          'data-spells': ['./src/data/spells.json'],
          'data-equipment': ['./src/data/equipment.json'],
          'data-feats': ['./src/data/feats.json'],
          'data-shop': [
            './src/data/gear.json',
            './src/data/magicItems.json',
            './src/data/weapons.json',
            './src/data/settlements.json',
          ],
          'data-campaign': [
            './src/data/campaign-rotrl.json',
            './src/data/rotrl-encounters.json',
            './src/data/rotrl-context.json',
            './src/data/sandpoint.json',
          ],
          'data-world': [
            './src/data/worldMechanics.json',
            './src/data/ultimateCampaign.json',
            './src/data/sandpointMap.json',
            './src/data/advancedSystems.json',
            './src/data/dmToolsData.json',
          ],
        },
      },
    },
  },
})
