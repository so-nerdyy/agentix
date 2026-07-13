import type { PanelSection } from '../types.js'

export const SETUP_REQUIRED_TITLE = 'Setup Required'
const PRODUCT = process.env.AGENTIX_FRONTEND === 'agentix' ? 'Agentix' : 'Hermes'
const COMMAND = PRODUCT.toLowerCase()

export const buildSetupRequiredSections = (): PanelSection[] => [
  {
    text: `${PRODUCT} needs a model provider before the TUI can start a session.`
  },
  {
    rows: [
      ['/model', 'configure provider + model in-place'],
      ['/setup', 'run full first-time setup wizard in-place'],
      ['Ctrl+C', `exit and run \`${COMMAND} setup\` manually`]
    ],
    title: 'Actions'
  }
]
