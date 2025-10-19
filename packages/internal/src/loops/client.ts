import db from '@codebuff/common/db'
import * as schema from '@codebuff/common/db/schema'
import { eq } from 'drizzle-orm'
import { LoopsClient, APIError } from 'loops'

import type { LoopsEmailData, SendEmailResult } from './types'
import type {
  ParamsExcluding,
  OptionalFields,
} from '@codebuff/common/types/function-params'
import type { Logger } from '@codebuff/common/types/contracts/logger'

const ORGANIZATION_INVITATION_TRANSACTIONAL_ID = 'cmbikixxm15xo4a0iiemzkzw1'
const BASIC_TRANSACTIONAL_ID = 'cmb8pafk92r820w0i7lkplkt2'

// Initialize Loops client
let loopsClient: LoopsClient | null = null
if (process.env.LOOPS_API_KEY) {
  loopsClient = new LoopsClient(process.env.LOOPS_API_KEY)
}

async function sendTransactionalEmail(
  params: OptionalFields<
    {
      transactionalId: string
      email: string
      dataVariables: Record<string, any>
      logger: Logger
    },
    'dataVariables'
  >,
): Promise<SendEmailResult> {
  const withDefaults = {
    dataVariables: {},
    ...params,
  }
  const { transactionalId, email, dataVariables, logger } = withDefaults

  if (!loopsClient) {
    return {
      success: false,
      error:
        'Loops SDK not initialized (LOOPS_API_KEY missing or SDK init failed).',
    }
  }

  try {
    const response = await loopsClient.sendTransactionalEmail({
      transactionalId,
      email,
      dataVariables,
    })

    logger.info(
      { email, transactionalId, loopsId: (response as any)?.id },
      'Loops transactional email sent successfully via SDK',
    )
    return { success: true, loopsId: (response as any)?.id }
  } catch (error) {
    let errorMessage = 'Unknown SDK error during transactional email'
    if (error instanceof APIError) {
      logger.error(
        {
          ...error,
          email,
          transactionalId,
          errorType: 'APIError',
        },
        `Loops APIError sending transactional email: ${error.message}`,
      )
      errorMessage = `Loops APIError: ${error.message} (Status: ${error.statusCode})`
    } else {
      logger.error(
        { email, transactionalId, error },
        'An unexpected error occurred sending transactional email via Loops SDK',
      )
    }
    return { success: false, error: errorMessage }
  }
}

export async function sendSignupEventToLoops(params: {
  userId: string
  email: string | null
  name: string | null
  logger: Logger
}): Promise<void> {
  const { userId, email, name, logger } = params

  if (!loopsClient) {
    logger.warn({ userId }, 'Loops SDK not initialized. Skipping signup event.')
    return
  }
  if (!email) {
    logger.warn(
      { userId },
      'User email missing, cannot send Loops signup event.',
    )
    return
  }

  try {
    const response = await loopsClient.sendEvent({
      eventName: 'signup',
      email,
      userId,
      contactProperties: {
        firstName: name?.split(' ')[0] ?? '',
      },
    })

    logger.info(
      { email, userId, eventName: 'signup', loopsId: (response as any)?.id },
      'Sent signup event to Loops via SDK',
    )
  } catch (error) {
    if (error instanceof APIError) {
      logger.error(
        {
          ...error,
          email,
          userId,
          eventName: 'signup',
          errorType: 'APIError',
        },
        `Loops APIError sending event: ${error.message}`,
      )
    } else {
      logger.error(
        { error, email, userId, eventName: 'signup' },
        'An unexpected error occurred sending signup event via Loops SDK',
      )
    }
    // Original function did not return error status, just logged.
  }
}

export async function sendOrganizationInvitationEmail(params: {
  data: LoopsEmailData // data no longer contains firstName
  logger: Logger
}): Promise<SendEmailResult> {
  const { data, logger } = params

  let lookedUpFirstName: string = 'there' // Default to 'there'
  try {
    const inviteeUserRecord = await db
      .select({ name: schema.user.name })
      .from(schema.user)
      .where(eq(schema.user.email, data.email.toLowerCase())) // Compare email case-insensitively
      .limit(1)

    if (inviteeUserRecord.length > 0 && inviteeUserRecord[0].name) {
      lookedUpFirstName = inviteeUserRecord[0].name.split(' ')[0] || 'there'
    }
  } catch (error) {
    logger.error(
      {
        email: data.email,
        error,
        source: 'sendOrganizationInvitationEmail-lookup',
      },
      'Error fetching user by email for invitation, using default name.',
    )
    // Continue with default name 'there'
  }

  return sendTransactionalEmail({
    transactionalId: ORGANIZATION_INVITATION_TRANSACTIONAL_ID,
    email: data.email,
    dataVariables: {
      firstName: lookedUpFirstName, // Use the looked-up or default name
      organizationName: data.organizationName || '', // data.organizationName is still expected
      inviterName: data.inviterName || '', // data.inviterName is still expected
      invitationUrl: data.invitationUrl || '', // data.invitationUrl is still expected
      role: data.role || 'member', // data.role is still expected
    },
    logger,
  })
}

export async function sendBasicEmail(
  params: {
    data: { subject: string; message: string }
  } & ParamsExcluding<
    typeof sendTransactionalEmail,
    'transactionalId' | 'dataVariables'
  >,
): Promise<SendEmailResult> {
  const { data } = params

  return sendTransactionalEmail({
    ...params,
    transactionalId: BASIC_TRANSACTIONAL_ID,
    dataVariables: {
      subject: data.subject,
      message: data.message,
    },
  })
}
