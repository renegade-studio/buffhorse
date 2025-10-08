import { getOrganizationUsageResponse } from '@codebuff/billing'
import db from '@codebuff/common/db'
import * as schema from '@codebuff/common/db/schema'
import { INVALID_AUTH_TOKEN_MESSAGE } from '@codebuff/common/old-constants'
import { eq } from 'drizzle-orm'
import { z } from 'zod/v4'

import { checkAuth } from '../util/check-auth'
import { logger } from '../util/logger'
import { genUsageResponse } from '../websockets/websocket-action'

import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
  NextFunction,
} from 'express'

const usageRequestSchema = z.object({
  fingerprintId: z.string(),
  authToken: z.string().optional(),
  orgId: z.string().optional(),
})

async function getUserIdFromAuthToken(
  token: string,
): Promise<string | undefined> {
  const user = await db
    .select({ userId: schema.user.id })
    .from(schema.user)
    .innerJoin(schema.session, eq(schema.user.id, schema.session.userId))
    .where(eq(schema.session.sessionToken, token))
    .then((users) => users[0]?.userId)
  return user
}

async function usageHandler(
  req: ExpressRequest,
  res: ExpressResponse,
  next: NextFunction,
): Promise<void | ExpressResponse> {
  try {
    const { fingerprintId, authToken, orgId } = usageRequestSchema.parse(
      req.body,
    )
    const clientSessionId = `api-${fingerprintId}-${Date.now()}`

    const authResult = await checkAuth({
      fingerprintId,
      authToken,
      clientSessionId,
    })
    if (authResult) {
      const errorMessage =
        authResult.type === 'action-error'
          ? authResult.message
          : 'Authentication failed'
      return res.status(401).json({ message: errorMessage })
    }

    const userId = authToken
      ? await getUserIdFromAuthToken(authToken)
      : undefined

    if (!userId) {
      const message = authToken
        ? INVALID_AUTH_TOKEN_MESSAGE
        : 'Authentication failed'
      return res.status(401).json({ message })
    }

    // If orgId is provided, return organization usage data
    if (orgId) {
      try {
        const orgUsageResponse = await getOrganizationUsageResponse(
          orgId,
          userId,
        )
        return res.status(200).json(orgUsageResponse)
      } catch (error) {
        logger.error(
          { error, orgId, userId },
          'Error fetching organization usage',
        )
        // If organization usage fails, fall back to personal usage
        logger.info(
          { orgId, userId },
          'Falling back to personal usage due to organization error',
        )
      }
    }

    // Return personal usage data (default behavior)
    const usageResponse = await genUsageResponse({
      fingerprintId,
      userId,
      clientSessionId,
    })

    return res.status(200).json(usageResponse)
  } catch (error) {
    logger.error({ error }, 'Error handling /api/usage request')
    if (error instanceof z.ZodError) {
      return res
        .status(400)
        .json({ message: 'Invalid request body', issues: error.issues })
    }
    next(error)
    return
  }
}

export default usageHandler
