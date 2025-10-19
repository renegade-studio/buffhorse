import { processAndGrantCredit } from '@codebuff/billing'
import db from '@codebuff/common/db'
import * as schema from '@codebuff/common/db/schema'
import { convertCreditsToUsdCents } from '@codebuff/common/util/currency'
import { generateCompactId } from '@codebuff/common/util/string'
import { stripeServer } from '@codebuff/common/util/stripe'
import { env } from '@codebuff/internal'
import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod/v4'

import type { NextRequest } from 'next/server'

import { authOptions } from '@/app/api/auth/[...nextauth]/auth-options'
import { logger } from '@/util/logger'

const buyCreditsSchema = z.object({
  credits: z
    .number()
    .int()
    .min(500, { message: 'Minimum purchase is 500 credits.' }), // Enforce minimum purchase
})

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id || !session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const userId = session.user.id
  const userEmail = session.user.email

  let data
  try {
    data = await req.json()
    const validation = buyCreditsSchema.safeParse(data)
    if (!validation.success) {
      return NextResponse.json(
        { error: 'Invalid input', issues: validation.error.issues },
        { status: 400 }
      )
    }
    data = validation.data
  } catch (error) {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { credits } = data

  try {
    const user = await db.query.user.findFirst({
      where: eq(schema.user.id, userId),
      columns: { stripe_customer_id: true },
    })

    if (!user?.stripe_customer_id) {
      logger.error(
        { userId },
        'User attempting to buy credits has no Stripe customer ID.'
      )
      return NextResponse.json(
        { error: 'Stripe customer not found.' },
        { status: 400 }
      )
    }

    const centsPerCredit = 1
    const amountInCents = convertCreditsToUsdCents(credits, centsPerCredit)

    if (amountInCents <= 0) {
      logger.error(
        { userId, credits, centsPerCredit },
        'Calculated zero or negative amount in cents for credit purchase.'
      )
      return NextResponse.json(
        { error: 'Invalid credit amount calculation.' },
        { status: 400 }
      )
    }

    const operationId = `buy-${userId}-${generateCompactId()}`

    // Get customer's default payment method
    const customer = await stripeServer.customers.retrieve(
      user.stripe_customer_id
    )

    // Check if customer is not deleted and has invoice settings
    const defaultPaymentMethodId = !('deleted' in customer)
      ? (customer.invoice_settings?.default_payment_method as string | null)
      : null

    // If we have a default payment method, try to use it first
    if (defaultPaymentMethodId) {
      try {
        const paymentMethod = await stripeServer.paymentMethods.retrieve(
          defaultPaymentMethodId
        )

        // Check if payment method is valid (not expired for cards)
        const isValid =
          paymentMethod.type === 'link' ||
          (paymentMethod.type === 'card' &&
            paymentMethod.card?.exp_year &&
            paymentMethod.card.exp_month &&
            new Date(
              paymentMethod.card.exp_year,
              paymentMethod.card.exp_month - 1
            ) > new Date())

        if (isValid) {
          const paymentIntent = await stripeServer.paymentIntents.create({
            amount: amountInCents,
            currency: 'usd',
            customer: user.stripe_customer_id,
            payment_method: defaultPaymentMethodId,
            off_session: true,
            confirm: true,
            description: `${credits.toLocaleString()} credits`,
            metadata: {
              userId,
              credits: credits.toString(),
              operationId,
              grantType: 'purchase',
            },
          })

          if (paymentIntent.status === 'succeeded') {
            // Grant credits immediately
            await processAndGrantCredit({
              userId,
              amount: credits,
              type: 'purchase',
              description: `Direct purchase of ${credits.toLocaleString()} credits`,
              expiresAt: null,
              operationId,
              logger,
            })

            logger.info(
              {
                userId,
                credits,
                operationId,
                paymentIntentId: paymentIntent.id,
              },
              'Successfully processed direct credit purchase'
            )

            return NextResponse.json({ success: true, credits })
          }
        }
      } catch (error: any) {
        // If direct charge fails, fall back to checkout
        logger.warn(
          { userId, error: error.message },
          'Direct charge failed, falling back to checkout'
        )
      }
    }

    // Fall back to checkout session if direct charge failed or no valid payment method
    const checkoutSession = await stripeServer.checkout.sessions.create({
      payment_method_types: ['card', 'link'],
      customer: user.stripe_customer_id,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Codebuff Credits - ${credits.toLocaleString()}`,
              description: 'One-time credit purchase. Credits do not expire.',
            },
            unit_amount: amountInCents,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      success_url: `${env.NEXT_PUBLIC_CODEBUFF_APP_URL}/payment-success?session_id={CHECKOUT_SESSION_ID}&purchase=credits&amt=${credits}`,
      cancel_url: `${env.NEXT_PUBLIC_CODEBUFF_APP_URL}/usage?purchase_canceled=true`,
      metadata: {
        userId: userId,
        credits: credits.toString(),
        operationId: operationId,
        grantType: 'purchase',
      },
      payment_intent_data: {
        setup_future_usage: 'off_session',
        metadata: {
          userId: userId,
          credits: credits.toString(),
          operationId: operationId,
          grantType: 'purchase',
        },
      },
    })

    if (!checkoutSession.url) {
      logger.error(
        { userId, credits },
        'Stripe checkout session created without a URL.'
      )
      return NextResponse.json(
        { error: 'Could not create Stripe checkout session.' },
        { status: 500 }
      )
    }

    logger.info(
      { userId, credits, operationId, sessionId: checkoutSession.id },
      'Created Stripe checkout session for credit purchase'
    )

    return NextResponse.json({ sessionId: checkoutSession.id })
  } catch (error: any) {
    logger.error(
      { error: error.message, userId, credits },
      'Failed to process credit purchase'
    )
    const stripeErrorMessage =
      error?.raw?.message || 'Internal server error processing purchase.'
    return NextResponse.json({ error: stripeErrorMessage }, { status: 500 })
  }
}
