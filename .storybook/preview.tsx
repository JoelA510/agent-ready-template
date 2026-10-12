import type { Preview } from '@storybook/react-vite'
import { withThemeByClassName } from '@storybook/addon-themes'

import '../src/styles/globals.css'

// The browser tier renders every story once per theme (vitest.browser.config.ts defines this);
// anywhere else, the constant doesn't exist and stories start in light.
declare const __STORYBOOK_THEME__: string | undefined

const preview: Preview = {
  initialGlobals: {
    theme: typeof __STORYBOOK_THEME__ === 'string' ? __STORYBOOK_THEME__ : 'light',
  },
  parameters: {
    controls: {
      matchers: {
        color: /(background|color)$/i,
        date: /Date$/i,
      },
    },
    options: {
      storySort: {
        order: [
          'Introduction',
          'Foundations',
          ['Colors', 'Typography', 'Spacing & Layout', 'Elevation & Motion', 'Iconography', 'Accessibility'],
          'Components',
          'Brand & Content',
          [
            'Voice & Tone',
            'Writing Principles',
            'Grammar & Mechanics',
            'Terminology',
            'Accessibility in Writing',
            'UI Copy Patterns',
            'Claims & Sourcing',
          ],
          'Governance',
          'Contributing',
        ],
      },
    },
    // axe runs after every story, in the Storybook UI and as a test in real Chromium
    // (`npm run test:browser`), where layout exists: so color contrast is measured as rendered,
    // not skipped as it is in jsdom. `error` fails the run on any violation.
    a11y: {
      test: 'error',
      // axe.run's options. `rules` is an object, which Storybook merges key by key into a
      // story's own, so a story that turns one rule off (beside its reason) keeps these. An
      // array (`config.rules`) would be replaced whole, silently dropping them.
      options: {
        rules: {
          // WCAG 2.2 SC 2.5.8 Target Size (Minimum): axe ships this rule disabled.
          'target-size': { enabled: true },
        },
      },
    },
    backgrounds: {
      disable: true,
    },
  },
  decorators: [
    withThemeByClassName({
      themes: {
        light: '',
        dark: 'dark',
      },
      defaultTheme: 'light',
    }),
    (Story) => (
      <div className="bg-background text-foreground p-6 font-sans">
        <Story />
      </div>
    ),
  ],
}

export default preview
