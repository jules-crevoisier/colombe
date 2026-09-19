/**
 * Thème du site : le thème par défaut de VitePress, sans sa police Inter, habillé de
 * l'identité « Pli » de Colombe (papier, encre bleu nuit, bec orange, Newsreader et
 * Instrument Sans auto-hébergées).
 */
import type { Theme } from 'vitepress'
import DefaultTheme from 'vitepress/theme-without-fonts'

// Polices auto-hébergées (licence SIL OFL 1.1), les mêmes que l'application.
import '@fontsource-variable/instrument-sans'
import '@fontsource-variable/newsreader/opsz.css'
import '@fontsource-variable/newsreader/opsz-italic.css'

import './style.css'
import ColombeLanding from './components/ColombeLanding.vue'

export default {
  extends: DefaultTheme,
  enhanceApp({ app }) {
    app.component('ColombeLanding', ColombeLanding)
  },
} satisfies Theme
