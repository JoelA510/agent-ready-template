import type { StorybookConfig } from '@storybook/react-vite'
import remarkGfm from 'remark-gfm'

const config: StorybookConfig = {
  stories: [
    '../docs/**/*.mdx',
    '../src/**/*.mdx',
    '../src/**/*.stories.@(js|jsx|mjs|ts|tsx)',
  ],
  addons: [
    '@storybook/addon-links',
    {
      name: '@storybook/addon-docs',
      // Enables GitHub-flavored markdown (tables, strikethrough, task lists) in .mdx
      // docs — the default MDX pipeline only supports CommonMark, and this system's
      // content pages lean on tables (terminology glossaries, do/don't lists, type
      // scales) constantly.
      options: {
        mdxPluginOptions: {
          mdxCompileOptions: {
            remarkPlugins: [remarkGfm],
          },
        },
      },
    },
    '@storybook/addon-a11y',
    '@storybook/addon-themes',
    'storybook-design-token',
  ],
  framework: {
    name: '@storybook/react-vite',
    options: {},
  },
  staticDirs: ['../public'],
  typescript: {
    reactDocgen: 'react-docgen-typescript',
  },
}

export default config
