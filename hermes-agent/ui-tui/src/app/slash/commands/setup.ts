import { withInkSuspended } from '@hermes/ink'

import { launchHermesCommand } from '../../../lib/externalCli.js'
import { runExternalSetup } from '../../setupHandoff.js'
import type { SlashCommand } from '../types.js'

const PRODUCT_COMMAND = process.env.AGENTIX_FRONTEND === 'agentix' ? 'agentix' : 'hermes'

export const setupCommands: SlashCommand[] = [
  {
    help: `run full setup wizard (launches \`${PRODUCT_COMMAND} setup\`)`,
    name: 'setup',
    run: (arg, ctx) =>
      void runExternalSetup({
        args: ['setup', ...arg.split(/\s+/).filter(Boolean)],
        ctx,
        done: 'setup complete — starting session…',
        launcher: launchHermesCommand,
        suspend: withInkSuspended
      })
  }
]
